import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { Driver, ManagedTransaction, TransactionPromise } from 'neo4j-driver-core';

dotenv.config();

const app: Express = express();
const port = process.env.PORT;
const neo4j = require('neo4j-driver');
let driver: any | ManagedTransaction;

(async () => {
  require('dotenv').config({
    path: 'Neo4j-b04d4356-Created-2024-03-12.txt',
    debug: true  // to raise file/parsing errors
  })

  const URI = process.env.NEO4J_URI
  const USER = process.env.NEO4J_USERNAME
  const PASSWORD = process.env.NEO4J_PASSWORD
  let info: { start: string, destinations: string[]}[] = []

  // debugging and connecting
  try {
    driver = neo4j.driver(URI,  neo4j.auth.basic(USER, PASSWORD))
    const serverInfo = await driver.getServerInfo()
    console.log('Connection estabilished')
    console.log(serverInfo)
  } catch(err: any) {
    console.log(`Connection error\n${err}\nCause: ${err.cause}`)
    await driver.close()
  }

  // below is example query

  let session = driver.session({ database: 'neo4j' });

  let { records, summary } = await session.executeRead(
    async (tx: ManagedTransaction) => {
    return await tx.run(
      `
        MATCH (t)
        WHERE ((t:junction) OR (t:entrance))
        RETURN t.name AS start, 
          COLLECT {
            MATCH (t)-[:CONNECTED_TO]->(v)
            WHERE ((v:junction) OR (v:entrance))
            RETURN v.name
          } AS destinations
      `
    )
  })

  // console.log(records)

  for (let node of records) {
    info.push(
      {
        start: node.get("start"),
        destinations: node.get("destinations")
      }
    )
  }

  // for (let node of records) {
  //   info.push(
  //     {
  //       start: [
  //               node.get("p.name"),
  //               node.get("p.latitude"),
  //               node.get("p.longitude")
  //             ],
  //       destination: [
  //               node.get("q.name"),
  //               node.get("q.latitude"),
  //               node.get("q.longitude")
  //             ]
  //     }
  //   )
  // }

  console.log(info)

})();

app.get('/', (req: Request, res: Response) => {
  res.send('Gopher Tunnels back-end');
});

// return path; does not work -> returns same route
// structure a list that returns tuples of latitude and longitude
app.get('/routes', (req: Request, res: Response) => {
  let info: {start: [string, number, number], destination: [string, number, number]}[] = [];

  (async () => {
  // below is example query

  let session = driver.session({ database: 'neo4j' });

  let { records, summary } = await session.executeRead(
    async (tx: ManagedTransaction) => {
    return await tx.run(
      `
        MATCH (p), (q)
        WHERE ((p:junction) OR (p:entrance)) 
              AND ((q:junction) OR (q:entrance)) 
              AND (p)-[:IS_CONNECTED]->(q)
        RETURN p.name, p.latitude, p.longitude
      `
    )
  })

  for (let node of records) {
    info.push(
      {
        start: [
                node.get("p.name"),
                node.get("p.latitude"),
                node.get("p.longitude")
              ],
        destination: [
                node.get("q.name"),
                node.get("q.latitude"),
                node.get("q.longitude")
              ]
      }
    )
  }
  })();

  res.send("routes");

});

process.on('exit', async () => {
  try {
    await driver.close()
  } catch (err: any) {
    console.log(`Error ${err}: ${err.cause}`)
  }
  console.log("Program Exited")
  return
});

app.listen(port, () => {
  console.log(`App is listening on ${port}`);
});
