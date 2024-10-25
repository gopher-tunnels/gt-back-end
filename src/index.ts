import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import routingRoutes from './routes/routing.route';
// import axios from "axios";
import { Driver, ManagedTransaction, routing, Session, TransactionPromise } from 'neo4j-driver-core';

import swaggerUi from "swagger-ui-express"
import swaggerOutput from './swagger_output.json'

dotenv.config();

const app: Express = express();
const port = process.env.PORT;

const neo4j = require('neo4j-driver');
const queries = require('./queries');
const processing = require('./processing');
export let driver: any;
export let session: Session;

// ANNOTATIONS
// const swaggerUi = require('swagger-ui-express');
// const swaggerJsDoc = require('swagger-jsdoc');
// const swaggerOptions = {
//   swaggerDefinition: {
//     openai: '3.0.0',
//     info: {
//       title: 'Express API for JSONPlaceholder',
//       version: '1.0.0',
//       description:
//         'This is a REST API application made with Express. It retrieves data from JSONPlaceholder.',
//       license: {
//         name: 'Licensed Under MIT',
//         url: 'https://spdx.org/licenses/MIT.html',
//       },
//       contact: {
//         name: 'JSONPlaceholder',
//         url: 'https://jsonplaceholder.typicode.com',
//       },
//     },
//     servers: [
//       {
//         url: 'http://localhost:8000',
//         description: 'Development server',
//       },
//     ]
//   },
//   apis: ['./routes/*.ts'], // files containing annotations as above
// };

// const swaggerSpec  = swaggerJsDoc(swaggerOptions);

// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerOutput));

// END_OF_ANNOTATIONS

(async () => {
  const URI = process.env.NEO4J_URI
  const USER = process.env.NEO4J_USERNAME
  const PASSWORD = process.env.NEO4J_PASSWORD

  const info: { start: any, destinations: any[] }[] = []

  // debugging and connecting

  try {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
    const serverInfo = await driver.getServerInfo()
    console.log('Connection estabilished')
    console.log(serverInfo)
  } catch(err: any) {
    console.log(`Connection error\n${err}\nCause: ${err.cause}`)
  }

})();

// app.get('/', (req: Request, res: Response) => {
//   res.send('Gopher Tunnels back-end');
// });

// return path; dummy route -> returns same route
// structure a list that returns tuples of latitude and longitude
app.use("/api/routing", routingRoutes);

app.get('/search?', (req: Request, res: Response) => {
  (async () => {
    const name = req.query.name
    session = driver.session({ database: 'neo4j' });

    // shortest route example
    let { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => {
        return await tx.run(queries.searchName(name))
      }
    )

    // queries matched
    res.json(processing.processSearch(records))

  })()

})

app.post('/setroute', (req: Request, res: Response) => {
  (async () => {
    const start = req.body.start
    const destination = req.body.destination

  })()
})

// close exit app when app is interrupted
process.on("SIGINT", async () => {
  process.exit(1)
});

// close database connection when app is exited
process.on("exit", async (code) => {
  await session.close();
	await driver.close();
});

app.listen(port, () => {
  console.log(`App is listening on ${port}`);
});
