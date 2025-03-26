import { Request, Response, NextFunction } from 'express';
import { findDir } from './utils/directions'
import { driver } from './db';
import {Node, Record} from "neo4j-driver"
import path from 'path';

type pathNode = {
  building_name: string;
  x: number;
  y: number;
};

function closestNode(buildings: pathNode[], user_x: number, user_y: number, targetBuilding: string): pathNode | "not connectable" {
  const destination = buildings.find(b => b.building_name === targetBuilding);
  if (!destination) return "not connectable";

  const distanceToDestination = Math.hypot(destination.x - user_x, destination.y - user_y);

  const validBuildings = buildings.filter(building => {
    const buildingToDestination = Math.hypot(
      destination.x - building.x,
      destination.y - building.y
    );

    return buildingToDestination <= distanceToDestination;
  });

  if (validBuildings.length === 0) return "not connectable";

  const distanceFromCurrent = (b: pathNode) => Math.hypot(b.x - user_x, b.y - user_y);

  return validBuildings.reduce((closest, current) =>
    distanceFromCurrent(current) < distanceFromCurrent(closest) ? current : closest
  );
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
            b.x AS x, 
            b.y AS y
  `
  try {
    const { records, summary } = await driver.executeQuery(query, {}, { routing: 'READ', database: "neo4j" });

    const buildings: pathNode[] = records.map(record => ({
      building_name: record.get("building_name"),
      visits: record.get("visits"),
      x: record.get("x"),
      y: record.get("y"),
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
  const x = parseFloat(req.query.x as string);
  const y = parseFloat(req.query.y as string);

  if (!targetBuilding || isNaN(x) || isNaN(y)) {
    console.error ("Missing target building or coordinates");
    res.status(400).send("Invalid query parameters");
  }

  let connectedBuildings
  try {
    const { records, summary } = await driver.executeQuery(`
      MATCH (start:Node {building_name: "Ford Hall", type: "building_node"})
      RETURN start.building_name AS name, start.x AS x, start.y AS y
      UNION
      MATCH (start:Node {building_name: "Ford Hall", type: "building_node"})
      MATCH path = (start)-[*1..400]-(connected:Node)
      WHERE connected.type = "building_node"
        AND connected <> start
      RETURN DISTINCT connected.building_name AS name, connected.x AS x, connected.y AS y
    `,{ targetBuilding: targetBuilding },
    { routing: 'READ', database: "neo4j" });

    connectedBuildings = records.map(record => ({
      building_name: record.get("name"),
      x: record.get("x"),
      y: record.get("y"),
    }));

    const closest = closestNode(connectedBuildings, x, y, targetBuilding)
    res.json(closest)
  } catch(err: any) {
    console.log("Error finding connected", err)
    res.status(500).send("Failed finding connected")
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
function getDistance(lat1: number, long1: number, lat2: number, long2: number){
  return Math.sqrt(Math.pow((lat2-lat1), 2) + Math.pow((long2-long1), 2));
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