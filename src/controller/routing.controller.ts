import { Request, Response, NextFunction } from 'express';
import { findDir } from './utils/directions'
import { driver } from './db';
import {Node, Record} from "neo4j-driver"

//TESTING
import testBuildings from "../testBuildings.json"

type Building = {
  building_name: string;
  visits: number;
  x: number;
  y: number;
};

function closestNode(buildings: Building[], x0: number, y0: number): Building {
  return buildings.reduce((closest, current) => {
    const dist = (b: Building) => Math.hypot(b.x - x0, b.y - y0);
    return dist(current) < dist(closest) ? current : closest;
  });
}

export async function getClosestNode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const x = parseFloat(req.query.x as string);
    const y = parseFloat(req.query.y as string);

    if (isNaN(x) || isNaN(y)) {
      res.status(400).json({ error: "Missing or invalid 'x' or 'y' query parameters." });
    }

    const buildings = testBuildings as Building[];
    const closest = closestNode(buildings, x, y);

    res.status(200).json(closest);
  } catch (error) {
    console.error("Error in getClosestNode:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Retrieves all building nodes from the database.
 * 
 * @returns An array of all building nodes with building_name, visits, x, and y.
 */
export async function getAllBuildings(req: Request, res: Response, next: NextFunction): Promise<void> {
  const query = `
    MATCH (b:Building)
    RETURN b.building_name AS building_name, 
            b.visits AS visits,
            b.x AS x, 
            b.y AS y
  `
  try {
    const { records, summary } = await driver.executeQuery(query, {}, { routing: 'READ', database: "neo4j" });

    const buildings: Building[] = records.map(record => ({
      building_name: record.get("building_name"),
      visits: record.get("visits"),
      x: record.get("x"),
      y: record.get("y"),
    }));

    res.json(buildings);
  } catch (error) {
    console.error("Error fetching buildings from database", error);
    res.status(500).json({ error: {
      message: "Error fetching buildings from database",
      status: 500,
      details: error
    }});
  }
}

// establish a valid session
export async function buildingRouting(req: Request, res: Response, next: NextFunction) {

  const start = String(req.query.start).toLowerCase();
  const destination = String(req.query.destination).toLowerCase();

  res.json(connectedBuildings(destination));

  /*
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
    */

}

export function userLocationRoute(req: Request, res: Response, next: NextFunction) {
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
    res.status(400).send("invalid latitude, longitude, destination");
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



/**

Retrieves all building nodes that can be connected to the target building node.
@param targetBuilding - The name of the target building.
@returns an array of connected building nodes.
*/
async function connectedBuildings(targetBuilding:string): Promise<Node[]>{
  const session=driver!.session(); 
  const res:Node[]=[];
  
  try{
    const result=await session.run(
      
      `
      MATCH (n: Node {building_name: $targetBuiding, type: "building_node"})-[*1..]-(connected)
      WHERE connected.type="building_node"
      RETURN connected

      `, {targetBuilding:targetBuilding}
    )
    
    result.records.forEach(record=>{
      res.push(record.get("connected"))
    }


  )
  }finally{
    await session.close();
  }
  return res;
}
/**
 * calculate the total distance of the path using Euclidean distance between consecutive nodes.
 * @param path an array of nodes, each node has x,y coordinates
 * @returns the total distance from the start to the end
 *
 */
async function getDistance(path: Array<Node>): Promise<number>{
  //helper function to calculate distance(in km) from lattitude and longtitude
  function getDistanceFromLatLonInKm(lat1:number,lon1:number,lat2:number,lon2:number):number {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2-lat1);  // deg2rad below
    var dLon = deg2rad(lon2-lon1); 
    var a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2)
      ; 
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    var d = R * c; // Distance in km
    return d;
  }
  //helper function to convert an angle from degrees to radians
  function deg2rad(deg:number):number {
    return deg * (Math.PI/180)
  }
  let sum=0
  for(let i=0;i<path.length-1;i++){
    let start=path[i];
    let end=path[i+1];
    let dis=getDistanceFromLatLonInKm(start.properties.x,start.properties.y,end.properties.x,end.properties.y);
    sum=sum+dis;
  }
  return sum;
}

/**
 * Estimates the travel time based on distance, number of elevators, and other traversal conditions.
 * Now we are using an 'assuming' speed.
 * @param distance the distance of a route
 * @returns the time(minutes)
 */
async function getTime(distance:number):Promise<number>{
  const assuming_V=0.1//0.1 km/minute
  return  Math.round((distance/assuming_V)* 100) / 100;// round to 2 decimal places
}

// close database connection when app is exited
process.on("exit", async (code) => {
  await driver?.close();
});
