import { Request, Response, NextFunction } from 'express';
import { findDir } from './utils/directions'
import { driver } from './db';
import {Node, Record} from "neo4j-driver"
import path from 'path';

type pathNode = {
  building_name: string;
  longitude: number;
  latitude: number;
};

/**
 * Retrieves 3 closets nodes.
 * TODO: Add a 4th node that is at least behind the user just in case.
 * - Use vector normalization for better foward measuring
 * - Remove nodes from closest array that are part of immediate path for closer ones.
 * 
 * @returns An array of the 3 closest building nodes in order from closest to furthest
 */
function closestNode(buildings: pathNode[], user_longitude: number, user_latitude: number, targetBuilding: string): pathNode[] | "not connectable" {
  const destination = buildings.find(b => b.building_name === targetBuilding);
  if (!destination) return "not connectable";

  const userToDestDist = getDistance(user_latitude, user_latitude, destination.longitude, destination.latitude)

  const forwardBuildings = buildings.filter((building => {
    const buildingToDestDist = getDistance(building.longitude, building.latitude, destination.longitude, destination.latitude)
    return buildingToDestDist < (userToDestDist * 1.06) // backwards leeway weight 
  }))

  forwardBuildings.sort((a, b) => {
    const distA = Math.hypot(a.longitude - user_longitude, a.latitude - user_latitude);
    const distB = Math.hypot(b.longitude - user_longitude, b.latitude - user_latitude);
    return distA - distB;
  });

  const top3 = forwardBuildings.slice(0, 3);

  return top3;
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
            b.longitude AS longitude, 
            b.latitude AS latitude
  `
  try {
    const { records, summary } = await driver.executeQuery(query, {}, { routing: 'READ', database: "neo4j" });

    const buildings: pathNode[] = records.map(record => ({
      building_name: record.get("building_name"),
      longitude: record.get("longitude"),
      latitude: record.get("latitude"),
    }));

    res.json(buildings);
  } catch (error: any) {
      console.error("Error fetching buildings from database", error);
      res.status(500).send("Error fetching buildings from database");
  }
}

/**
 * Computes and returns the full navigable route from a given start location to a target building.
 * 
 * @param coords - The starting location as longitude, latitude coordinates.
 * @param targetDestination - The name of the target building.
 * @returns A array of route objects that the frontend can display.
 */
export async function getRoute(req: Request, res: Response, next: NextFunction) {
  const targetBuilding = String(req.query.targetBuilding);
  const longitude = parseFloat(req.query.longitude as string);
  const latitude = parseFloat(req.query.latitude as string);

  if (!targetBuilding || isNaN(longitude) || isNaN(latitude)) {
    console.error ("Missing target building or coordinates");
    res.status(400).send("Invalid query parameters");
  }

  let connectedBuildings
  let session = driver.session({ database: 'neo4j' })
  try {
    let {records, summary} = await session.executeRead(async tx => {
      return await tx.run(`
        MATCH (start:Node {building_name: "Ford Hall", type: "building_node"})
        RETURN start.building_name AS name, start.longitude AS longitude, start.latitude AS latitude
        UNION
        MATCH (start:Node {building_name: "Ford Hall", type: "building_node"})
        MATCH path = (start)-[*1..400]-(connected:Node)
        WHERE connected.type = "building_node"
        AND connected <> start
        RETURN DISTINCT connected.building_name AS name, connected.longitude AS longitude, connected.latitude AS latitude
        `, { targetBuilding: targetBuilding },
      )
    })
    
    connectedBuildings = records.map(record => ({
      building_name: record.get("name"),
      longitude: record.get("longitude"),
      latitude: record.get("latitude"),
    }));

    const closest = closestNode(connectedBuildings, longitude, latitude, targetBuilding)
    


    res.json(closest)
  } catch(err: any) {
    console.log("Error finding Route", err)
    res.status(500).send("Failed finding Route")
  } finally {
    session.close()
  }

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

// returns Euclidien distance between two geopositions
function getDistance(x1: number, y1: number, x2: number, y2: number){
  return Math.sqrt(Math.pow((x2-x1), 2) + Math.pow((y2-y1), 2));
}

/**

Retrieves all building nodes that can be connected to the target building node.
@param targetBuilding - The name of the target building.
@returns an array of connected building nodes.
*/
/*
async function connectedBuildings(targetBuilding:string): Promise<Node[]>{  
  try{
    const { records, summary } = await driver.executeQuery(`
        MATCH (n: Node {building_name: $targetBuiding, type: "building_node"})-[*1..]-(connected)
        WHERE connected.type="building_node"
        RETURN connected
      `,{ targetBuilding: targetBuilding },
      { routing: 'READ', database: "neo4j" });
    
    result.records.forEach(record=>{
      res.push(record.get("connected"))
    }
  )
  } catch (error: any ) {
    console.log("error finding connected buildings.")
  }
  return res;
}*/