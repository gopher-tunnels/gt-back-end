import express, { Express, Request } from 'express';
import { driver, verifyConnection } from './controller/db';

import dotenv from 'dotenv';
import routingRoutes from './routes/routing.route';
// import axios from "axios";

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
app.use('/api/routing', requestRateLimiter, requestSecurityMiddleware, routingRoutes);

// close exit app when app is interrupted
process.on('SIGINT', async () => {
  process.exit(1);
});

// for testing
// starts app regardless of db connection.
verifyConnection().finally(() => {
  app.listen(port, () => {
    console.log(`\nServer running on http://localhost:${port}\n`);
  });
});
