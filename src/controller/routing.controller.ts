import express, { Express, Request, Response, NextFunction } from 'express';
import { Driver, ManagedTransaction, routing, Session, TransactionPromise } from 'neo4j-driver-core';
import dotenv from 'dotenv';

dotenv.config();

const neo4j = require('neo4j-driver');
export let driver: any;
export let session: Session;

export let BUILDINGS: any[] = [];

// connecting to database and load static data
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
    session = driver.session({ database: 'neo4j' });

    // might be a stupid long-term solution, but works for now
    const { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => await tx.run(`MATCH (b:building) RETURN b`) // might just take name?
    )
    BUILDINGS = records.map(record => record.get("b").properties).filter(props => props.name != undefined);
  } catch(err: any) {
    console.log(`Connection error\n${err}\nCause: ${err.cause}`)
  }

})();

// establish a valid session

export function buildingRouting(req: Request, res: Response, next: NextFunction) {
  (async () => {
    // instead of going forwards, go backwards to find user location, getting to closest building
    // have a confidece bound of some sort (greedy) 
    // const MAPTOKEN = process.env.MAPTOKEN
    // const start: {longitude: Number, latitude: Number} | any = req.query.start
    // const destination: {longitude: Number, latitude: Number} | any = req.query.destination
    const start = req.query.start
    const destination = req.query.destination

    // session = driver.session({ database: 'neo4j' });

    // try {
    //   const query = axios.get(
    //             `https://api.mapbox.com/directions/v5/mapbox/walking/${start.longitude},${start.latitude};${destination.longitude},${destination.latitude}?steps=true&geometries=geojson&access_token=${MAPTOKEN}`,
    //         ).then((response) => {
    //             console.log(response)
    //             // const json = response.json();
    //             // const data = json.routes[0];
    //             // const route = data.geometry.coordinates;

    //             // console.log(json.routes);
    //             // console.log(json.routes[0].legs[0].steps);
    //             return response
    //         })
    // } catch (err: any) {
    //   console.log("Query issue")
    // }

    // shortest route example
    let { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => {
        return await tx.run(
            `MATCH p=shortestPath(
            (startNode:entrance|junction {name: \"${start}\"})-[*]-(endNode:entrance|junction {name: \"${destination}\"}))
            RETURN p`
        )
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
    res.json(route);
  })()
}

// gets top 5 popular routes
export function popularRoutes(req: Request, res: Response, next: NextFunction) {
  (async () => {

    let { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => {
        return await tx.run(`
          MATCH (a)-[b:ROUTED_TO]->(c) 
          RETURN a.name AS start, c.name AS destination, b.visits AS visits, b.path AS path
          ORDER BY visits DESC
          LIMIT 5
        `)
      }
    )

    const routes: any = []

    for (const record of records) {
      const route: any = {}
      for (const field of record.keys)
        field == "visits" ? route[field] = record.get(field).low : route[field] = record.get(field)
        
      routes.push(route)
    }

    res.json({ routes: routes })
  })()
}

// could be improved with a fuzzy find or some sorting
export function searchBar(req: Request, res: Response) {
  (async () => {
    let name = req.query.name?.toString().toLowerCase();
    const matches = BUILDINGS.filter(building => building.name.toLowerCase().includes(name)).slice(0, 5)
    res.json(matches)
  })()
}

// close database connection when app is exited
process.on("exit", async (code) => {
  try {
    await session.close();
	  await driver.close();
  } catch {
    console.log("Database connection failed to close");
  }
  
});
