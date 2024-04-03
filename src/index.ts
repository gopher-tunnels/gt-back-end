import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { Driver, ManagedTransaction, TransactionPromise } from 'neo4j-driver-core';

dotenv.config();

const app: Express = express();
const port = process.env.PORT;

const neo4j = require('neo4j-driver');
let driver: ManagedTransaction | any;

(async () => {
  const URI = process.env.URI
  const USER = process.env.USER
  const PASSWORD = process.env.PASSWORD

  let info: { start: any, destinations: any[] }[] = []

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

  // query retrieves all nodes

  let session = driver.session({ database: 'neo4j' });

  let { records, summary } = await session.executeRead(
    async (tx: ManagedTransaction) => {
    return await tx.run(
      `
        MATCH (t)
        WHERE ((t:junction) OR (t:entrance))
        RETURN t AS start, 
          COLLECT {
            MATCH (t)-[:CONNECTED_TO]->(v)
            WHERE ((v:junction) OR (v:entrance))
            RETURN v
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
    // console.log(node.get("start")["properties"])
  }

  for (let node of info) {
    console.log(node["start"].properties)
    // console.log(node["destinations"])
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

  // console.log(info)

})();

app.get('/', (req: Request, res: Response) => {
  res.send('Gopher Tunnels back-end');
});

// return path; does not work -> returns same route
// structure a list that returns tuples of latitude and longitude
app.get('/route?', (req: Request, res: Response) => {
  const start = req.query.start
  const destination = req.query.destination
  // TODO

  console.log(req.query)

  res.send(start + " " + destination)
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
