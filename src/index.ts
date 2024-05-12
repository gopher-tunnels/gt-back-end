import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { Driver, ManagedTransaction, Session, TransactionPromise } from 'neo4j-driver-core';

dotenv.config();

const app: Express = express();
const port = process.env.PORT;

const neo4j = require('neo4j-driver');
const queries = require('./queries');
const processing = require('./processing');
let driver: ManagedTransaction | any;
let session: Session;

(async () => {
  const URI = process.env.URI
  const USER = process.env.USER
  const PASSWORD = process.env.PASSWORD

  const info: { start: any, destinations: any[] }[] = []

  // debugging and connecting

  try {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
    const serverInfo = await driver.getServerInfo()
    console.log('Connection estabilished')
    console.log(serverInfo)
  } catch(err: any) {
    console.log(`Connection error\n${err}\nCause: ${err.cause}`)
    await driver.close()
  }

  // query retrieves all nodes
  session = driver.session({ database: 'neo4j' });

  let { records, summary } = await session.executeRead(
    async (tx: ManagedTransaction) => {
      return await tx.run(queries.getAllMajor())
    }
  )

  for (let node of records) {
    info.push(
      {
        start: node.get("start"),
        destinations: node.get("destinations")
      }
    )
    // console.log(node.get("start")["properties"])
  }

  // await session.close()

  // for (let node of info) {
    // console.log(node["start"].properties)
    // console.log(node["destinations"])
  //   console.log(node)
  // }

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

// return path; dummy route -> returns same route
// structure a list that returns tuples of latitude and longitude
app.get('/route?', (req: Request, res: Response) => {
  (async () => {   
    const MAPTOKEN = process.env.MAPTOKEN
    const start: {longitude: Number, latitude: Number} | any = req.query.start
    const destination: {longitude: Number, latitude: Number} | any = req.query.destination
    session = driver.session({ database: 'neo4j' });

    try {
      const query = axios.get(
                `https://api.mapbox.com/directions/v5/mapbox/walking/${start.longitude},${start.latitude};${destination.longitude},${destination.latitude}?steps=true&geometries=geojson&access_token=${MAPTOKEN}`,
            ).then((response) => {
                console.log(response)
                // const json = response.json();
                // const data = json.routes[0];
                // const route = data.geometry.coordinates;

                // console.log(json.routes);
                // console.log(json.routes[0].legs[0].steps);
                return response
            }
        )
    } catch (err: any) {
      console.log("Query issue")
    }

    // shortest route example
    let { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => {
        return await tx.run(queries.getPath(start, destination))
      }
    )

    // processed path that is returned
    res.send(processing.processPath(records))

  })()

})

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
    res.send(processing.processSearch(records))

  })()

})

// close database connection when app is exited
process.on("exit", async (code) => {
  // await session.close();
	await driver.close();
});

// close database connection when SIGINT exits the app (testing purposes)
process.on("SIGINT", async () => {
  // await session.close();
	await driver.close();
});

app.listen(port, () => {
  console.log(`App is listening on ${port}`);
});
