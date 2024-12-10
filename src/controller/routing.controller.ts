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
            (startNode:building {name: \"${start}\"})-[*]-(endNode:building {name: \"${destination}\"}))
            RETURN p`
        )
      }
    )

    // processed path that is returned
    let path
    let route: { name: string, location: { latitude: string, longitude: string }}[] = []

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
    } catch (error) {
      console.error("Error creating or updating ROUTED_TO relationship:", error);
    }
    
    res.json(route);
  })()
}

export function geoPositionRoute(req: Request, res: Response, next: NextFunction) {
  let request = {
    lat: parseFloat(req.query.latitude as string),
    long: parseFloat(req.query.longitude as string),
    destBuildingName: req.query.destination
};

  if (
    isNaN(request.lat) || isNaN(request.long) || 
    request.lat < -90 || request.lat > 90 || 
    request.long < -180 || request.long > 180 ||
    !request.destBuildingName || typeof request.destBuildingName !== 'string'
  ) {
    return;
  } 

  const dest = BUILDINGS.find(
    (building) => building.name.toLowerCase() === "northrop auditorium".toLowerCase()
  );

  if (!dest) {
    return
  }

  let nearestBuilding = null;
  let shortestDistance = Infinity;

  for (const node of BUILDINGS) {
    const geoDistanceToDestination = getDistance(request.lat, request.long, dest.lat, dest.long);
    const geoDistanceToNode = getDistance(request.lat, request.long, node.latitude, node.longitude);
    const nodeDistanceToDestination = getDistance(node.latitude, node.longitude, dest.lat, dest.long);

    // Skip buildings that are further from the destination
    if (nodeDistanceToDestination > geoDistanceToDestination) {
      continue;
    }
  
    if (geoDistanceToNode < shortestDistance) {
      shortestDistance = geoDistanceToNode;
      nearestBuilding = node;
    }
  }
  
  // Check if on same campus
  if (dest.campus != nearestBuilding.campus) {
    console.log("Nearest building not on same campus");
    return
  } else {
    console.log("Nearest building:", nearestBuilding.name);
  }
  return nearestBuilding
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

    let name = req.query.input?.toString().toLowerCase();
    const matches = BUILDINGS.filter(building => building.name.toLowerCase().includes(name)).slice(0, 5)

    res.json(matches)
  })()
}

// returns Euclidien distance between two geopositions 
export function getDistance(lat1: number, long1: number, lat2: number, long2: number){
  return Math.sqrt(Math.pow((lat2-lat1), 2) + Math.pow((long2-long1), 2));
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
