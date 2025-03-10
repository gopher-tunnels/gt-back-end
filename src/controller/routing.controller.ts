import { Request, Response, NextFunction } from 'express';
import { ManagedTransaction, Session } from 'neo4j-driver-core';
import dotenv from 'dotenv';
import { findDir } from './utils/directions'

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

  // const info: { start: any, destinations: any[] }[] = []

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

export function getBuildings(req: Request, res: Response, next: NextFunction) {
  res.json({ "buildings": BUILDINGS })
}


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
            `MATCH p = SHORTEST 1 (start:building {name: \"${start}\"})-[:CONNECTED_TO]-+(destination:building {name: \"${destination}\"})
            WHERE start.campus = destination.campus
            RETURN p`
        )
      }
    )

    let route: { name: string, location: { latitude: string, longitude: string }, direction: string }[] = [];

    for (let record of records) {
      const path = record.get('p').segments;
      if (path.length === 0) continue; // if no segments, skip

      // processing each segment in the path
      for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        const nodePrev = segment.start;
        const node = segment.end;
        const nodeNext = i < path.length - 1 ? path[i + 1].end : null;
        // if start node, default to "straight"
        if (i == 0) {
          route.push({
            name: nodePrev.properties.name,
            location: {
              latitude: nodePrev.properties.latitude,
              longitude: nodePrev.properties.longitude,
            },
            direction: "straight"
          });
        } else {
          // add the current node
          route.push({
            name: node.properties.name,
            location: {
              latitude: node.properties.latitude,
              longitude: node.properties.longitude,
            },
            direction: nodeNext ? findDir(nodePrev, node, nodeNext) : ""
          });
        }

        // if this is the last segment, add the final node with no direction
        if (i === path.length - 1 && nodeNext) {
          route.push({
            name: nodeNext.properties.name,
            location: {
                latitude: nodeNext.properties.latitude,
                longitude: nodeNext.properties.longitude,
            },
            direction: ""
          });
        }
      }
    }
       
    // Create or update the ROUTED_TO relationship with visits property
    try {
      let result = await session.executeWrite(async (tx: ManagedTransaction) => {
        return await tx.run(
          `
          MATCH (startNode:building {name: $start}), (endNode:building {name: $destination})
          MERGE (startNode)-[r:ROUTED_TO]->(endNode)
          ON CREATE SET r.visits = 1
          ON MATCH SET r.visits = r.visits + 1
          RETURN r.visits AS visits
          `,
          { start, destination }
        );
      });
    
      // Retrieve and log the visits count (NOT NEEDED, FOR VERIFICATION)
      if (result.records.length > 0) {
        const visits = result.records[0].get('visits');
        console.log(`ROUTED_TO connection exists with visits: ${visits}`);
      } else {
        console.log("Failed to retrieve the visits count.");
      }
    } catch (error) {
      console.error("Error creating or updating ROUTED_TO relationship:", error);
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

    let input = req.query.input?.toString().toLowerCase();
    const matches = BUILDINGS.filter(building => building.name.toLowerCase().includes(input)).slice(0, 5)

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
