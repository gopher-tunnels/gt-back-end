import express, { Express, Request } from 'express';
import { verifyConnection } from './controller/db';
import { loadCache } from './services/graphLoader';

import dotenv from 'dotenv';
import routingRoutes from './routes/routing.route';

import swaggerUi from 'swagger-ui-express';
import swaggerOutput from './swagger_output.json';
import { buildRateLimiter } from './middleware/security';
import { applyTrustProxy, parseTrustProxy } from './utils/httpConfig';

dotenv.config();

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

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerOutput));

const requestRateLimiter = buildRateLimiter({
  validateXForwardedFor: trustProxy !== false,
});

app.use('/api/routing', requestRateLimiter, routingRoutes);

process.on('SIGINT', async () => {
  process.exit(1);
});

async function startServer(): Promise<void> {
  await loadCache();
  await verifyConnection();

  app.listen(port, () => {
    console.log(`\nServer running on http://localhost:${port}`);
    console.log(`API docs:   http://localhost:${port}/api-docs\n`);
  });
}

startServer().catch((err) => {
  console.error('[Startup] Fatal error:', err);
  process.exit(1);
});
