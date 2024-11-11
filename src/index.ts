import express, { Express } from 'express';
import dotenv from 'dotenv';
import routingRoutes from './routes/routing.route';
// import axios from "axios";

import swaggerUi from "swagger-ui-express"
import swaggerOutput from './swagger_output.json'

dotenv.config();

// starting the app
const app: Express = express();
const port = process.env.PORT;

// ROUTE DOCUMENTATION GENERATION
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerOutput));

// routes related to routing/buildings
app.use("/api/routing", routingRoutes);

// close exit app when app is interrupted
process.on("SIGINT", async () => {
  process.exit(1)
});

// for testing
app.listen(port, () => {
  console.log(`App is listening on ${port}`);
});
