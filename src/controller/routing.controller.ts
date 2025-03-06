import { Request, Response, NextFunction } from 'express';
import { Driver } from 'neo4j-driver';
import { findDir } from './utils/directions'
import { driver } from './db';

function dbExists(res: Response, driver: Driver | undefined): driver is Driver {
  if (!driver) {
    res.status(500).send("database connection not available");
    return false;
  }
  return true;
}

// TODO: implement using db connection rather than hardcoded data
export function getBuildings(req: Request, res: Response, next: NextFunction) {
  // try{
  //   if (req.query.Select === "All") {
  //     res.json(JSON.stringify({ "buildings": BUILDINGS }))
  //   }
  //   else if (req.query.Select === "Some") {
  //     const idList = (req.query.IDlist as string)?.split(",") || [];
  //     if (!idList || !Array.isArray(idList)) {
  //       throw new Error("IDlist must be provided and must be an array");
  //     }
  //     res.json(JSON.stringify({ "buildings": BUILDINGS.filter(building => idList.includes(building.id)) }))
  //   }
  //   else if (req.query.Select === "No") {
  //     res.json(JSON.stringify({ "buildings": [] }))
  //   }
  //   else {
  //     const error: Error = new Error("The Select parameter must be one of 'All', 'Some', or 'No'.");
  //     next(error);
  //   }
  // }
  // catch (err: any) {
  //   console.log("Query issue")
  //   next(err)
  // }
}

// establish a valid session
export async function buildingRouting(req: Request, res: Response, next: NextFunction) {
  if (!dbExists(res, driver)) {
    return;
  }

  const start = String(req.query.start).toLowerCase();
  const destination = String(req.query.destination).toLowerCase();

  try {
    // shortest route example
    let { records, summary } = await driver.executeQuery(
      `MATCH p = SHORTEST 1 (start:building {name: $start})-[:CONNECTED_TO]-+(destination:building {name: $destination})
      WHERE start.campus = destination.campus
      RETURN p`,
      {start, destination},
      {database: "neo4j"},
    );

    let route: { name: string, location: { latitude: string, longitude: string }, direction: string }[] = [];

    // processes intermediary and destination nodes
    const path = records[0].get('p').segments

    route.push(
      {
        name: path[0].start.properties.name,
        location: {
          latitude: path[0].start.properties.latitude,
          longitude: path[0].start.properties.longitude
        },
        direction: ""
      }
    )

    for (let segment of path) {
      const start_location = segment.end

      route.push(
        {
          name: start_location.properties.name,
          location: {
            latitude: start_location.properties.latitude,
            longitude: start_location.properties.longitude
          },
          direction: ""
        }
      )

      for (let i = 0; i < path.length - 1; i++) {
        let segment = path[i]
        let nextSegment = path[i + 1]
        let nodePrev = segment.start
        let node = segment.end
        let nodeNext = nextSegment.end
        route.push(
          {

            name: node.properties.name,
            location: {
              latitude: node.properties.latitude,
              longitude: node.properties.longitude,
            },
            direction: findDir(nodePrev.properties, node.properties, nodeNext.properties)
          }
        )
        if (i == path.length - 1) {
          route.push(
            {
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
    await driver.executeQuery(
      `
      MATCH (startNode:building {name: $start}), (endNode:building {name: $destination})
      MERGE (startNode)-[r:ROUTED_TO]->(endNode)
      ON CREATE SET r.visits = 1
      ON MATCH SET r.visits = r.visits + 1
      RETURN r.visits AS visits
      `,
      { start, destination }
    );
    res.json(route);

  } catch (error) {
    console.error("Error creating or updating ROUTED_TO relationship:", error);
    res.status(500).send("Error querying db");
  }

}

export function userLocationRoute(req: Request, res: Response, next: NextFunction) {
  let request = {
    lat: parseFloat(req.query.latitude as string),
    long: parseFloat(req.query.longitude as string),
    destBuildingName: req.query.destinatio
  };

  if (
    isNaN(request.lat) || isNaN(request.long) ||
      request.lat < -90 || request.lat > 90 ||
      request.long < -180 || request.long > 180 ||
      !request.destBuildingName || typeof request.destBuildingName !== 'string'
  ) {
    res.status(400).send("invalid latitude longitude destination");
    return;
  }

  // TODO: rewrite this section with buildings pulled from db
  // const dest = BUILDINGS.find(
  //   (building) => building.name.toLowerCase() === "northrop auditorium".toLowerCase()
  // );

  // if (!dest) {
  //   return
  // }

  // let nearestBuilding = null;
  // let shortestDistance = Infinity;

  // for (const node of BUILDINGS) {
  //   const geoDistanceToDestination = getDistance(request.lat, request.long, dest.lat, dest.long);
  //   const geoDistanceToNode = getDistance(request.lat, request.long, node.latitude, node.longitude);
  //   const nodeDistanceToDestination = getDistance(node.latitude, node.longitude, dest.lat, dest.long);

  //   // Skip buildings that are further from the destination
  //   if (nodeDistanceToDestination > geoDistanceToDestination) {
  //     continue;
  //   }

  //   if (geoDistanceToNode < shortestDistance) {
  //     shortestDistance = geoDistanceToNode;
  //     nearestBuilding = node;
  //   }
  // }

  // // Check if on same campus
  // if (dest.campus != nearestBuilding.campus) {
  //   console.log("Nearest building not on same campus");
  //   return
  // } else {
  //   console.log("Nearest building:", nearestBuilding.name);
  // }
  // res.json(nearestBuilding);
}

// gets top 5 popular routes
export async function popularRoutes(req: Request, res: Response, next: NextFunction) {
  if (!dbExists(res, driver)) {
    return;
  }

  try {
    let { records, summary } = await driver.executeQuery(`
      MATCH (a)-[b:ROUTED_TO]->(c)
      RETURN a.name AS start, c.name AS destination, b.visits AS visits, b.path AS path
      ORDER BY visits DESC
      LIMIT 5
    `);

    const routes: any = [];

    for (const record of records) {
      const route: any = {};
      for (const field of record.keys) {
        field == "visits" ? route[field] = record.get(field).low : route[field] = record.get(field);
      }
      routes.push(route);
    }

    res.json({ routes: routes });

  } catch (e) {
    console.error("popularRoutes failed: ", e);
    res.status(500).send("failed to query db");
  }
}

// could be improved with a fuzzy find or some sorting
export function searchBar(req: Request, res: Response) {
  // TODO: rewrite using db rather than BUILDINGS object
  // let input = req.query.input?.toString().toLowerCase();
  // const matches = BUILDINGS.filter(building => building.name.toLowerCase().includes(input)).slice(0, 5)
  // res.json(matches)
}

// returns Euclidien distance between two geopositions
function getDistance(lat1: number, long1: number, lat2: number, long2: number){
  return Math.sqrt(Math.pow((lat2-lat1), 2) + Math.pow((long2-long1), 2));
}

// close database connection when app is exited
process.on("exit", async (code) => {
  await driver?.close();
});
