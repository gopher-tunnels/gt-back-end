import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { Driver, ManagedTransaction, Session, TransactionPromise } from 'neo4j-driver-core';

dotenv.config();

const app: Express = express();
const port = process.env.PORT;

const neo4j = require('neo4j-driver');
const queries = require('./queries')
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

  session.close()

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
    const start = req.query.start
    const destination = req.query.destination
    session = driver.session({ database: 'neo4j' });

    // shortest route example
    let { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => {
        return await tx.run(queries.getPath(start, destination))
      }
    )

    // processed path that is returned
    let path
    const route: { name: string, location: { latitude: string, longitude: string }}[] = []

    // processes intermediary and destination nodes
    for (let record of records) {
      path = record.get('p').segments
      const start_location = path[0].start

      route.push(
        {
          name: start_location.properties.name,
          location: {
            latitude: start_location.properties.latitude,
            longitude: start_location.properties.longitude
          }
        }
      )

      for (let segment of path) {
        let node = segment.end

        route.push(
          {
            name: node.properties.name,
            location: {
              latitude: node.properties.latitude,
              longitude: node.properties.longitude
            }
          }
        )
      }
    }

    res.send(route)
    
  })()

  // session.close()
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
    let location
    const matches: { name: string, location: { latitude: string, longitude: string }}[] = []

    for (let record of records) {
      location = record.get('n')
      matches.push(
        {
          name: location.properties["name"],
          location: {
            latitude: location.properties["latitude"],
            longitude: location.properties["longitude"]
          }
        }
      )
    }

    res.send(matches)
  })()
})

// close database connection when app is exited
process.on("exit", async (code) => {
	await driver.close();
});

// close database connection when SIGINT exits the app (testing purposes)
process.on("SIGINT", async () => {
	await driver.close();
});

app.listen(port, () => {
  console.log(`App is listening on ${port}`);
});
