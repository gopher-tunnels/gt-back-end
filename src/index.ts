import express, { Express, Request } from 'express';
import { driver, verifyConnection } from './controller/db';
import { buildGraph, loadFromCacheIfExists } from './services/graphPrecomputer';
import { setGraphLoaded, getConnectionState } from './services/connectionState';

import dotenv from 'dotenv';
import routingRoutes from './routes/routing.route';

import swaggerUi from 'swagger-ui-express';
import swaggerOutput from './swagger_output.json';
import { buildRateLimiter, requestSecurityMiddleware } from './middleware/security';
import { applyTrustProxy, parseTrustProxy } from './utils/httpConfig';

dotenv.config();

// starting the app
const app: Express = express();
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
applyTrustProxy(app, trustProxy);
const port = process.env.PORT;

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  }),
);

// ROUTE DOCUMENTATION GENERATION
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerOutput));

// routes related to routing/buildings
const requestRateLimiter = buildRateLimiter({
  validateXForwardedFor: trustProxy !== false,
});

app.use(
  '/api/routing',
  requestRateLimiter,
  (req: Request & { rawBody?: string }, res, next) => {
    // Allow all GET requests without HMAC headers
    if (req.method === 'GET') {
      return next();
    }

    // Enforce HMAC security for non-GET methods (POST, PUT, PATCH, DELETE)
    return requestSecurityMiddleware(req, res, next);
  },
  routingRoutes,
);

// close exit app when app is interrupted
process.on('SIGINT', async () => {
  process.exit(1);
});

/**
 * Startup logic with offline mode support.
 *
 * Priority:
 * 1. SKIP_GRAPH_BUILD=true: Load from cache only, don't touch Neo4j for graph
 * 2. Neo4j available: Build graph normally (or load from cache if valid)
 * 3. Neo4j unavailable: Fall back to cache if available (offline mode)
 */
async function startServer(): Promise<void> {
  const neo4jConnected = await verifyConnection();

  if (process.env.SKIP_GRAPH_BUILD === 'true') {
    // Explicit skip - only use cache
    const cacheAge = await loadFromCacheIfExists();
    if (!cacheAge) console.warn('[Graph] No valid cache found - routes will fail. Run without SKIP_GRAPH_BUILD to build.');
    setGraphLoaded(!!cacheAge, cacheAge ?? undefined);
  } else if (neo4jConnected) {
    // Normal mode - build or load graph
    const session = driver.session({ database: 'neo4j' });
    try {
      const cacheAge = await buildGraph(session);
      setGraphLoaded(true, cacheAge ?? undefined);
    } finally {
      await session.close();
    }
  } else {
    // Neo4j unavailable - try cache fallback
    console.log('[Startup] Neo4j unavailable - attempting cache fallback...');
    const cacheAge = await loadFromCacheIfExists();
    if (cacheAge) {
      setGraphLoaded(true, cacheAge);
      console.log('[Startup] Running in OFFLINE MODE with cached graph data');
      console.log('[Startup] Note: Write operations (visit tracking) are disabled');
    } else {
      console.error('[Startup] No cache available and Neo4j unreachable');
      console.error('[Startup] Routing endpoints will return errors');
      setGraphLoaded(false);
    }
  }

  const state = getConnectionState();
  console.log(`[Startup] State: Neo4j=${state.neo4jAvailable ? 'connected' : 'disconnected'}, Graph=${state.graphLoaded ? 'loaded' : 'NOT loaded'}`);

  app.listen(port, () => {
    console.log(`\nServer running on http://localhost:${port}`);
    console.log(`API docs:   http://localhost:${port}/api-docs\n`);
  });
}

startServer().catch((err) => {
  console.error('[Startup] Fatal error:', err);
  process.exit(1);
});
