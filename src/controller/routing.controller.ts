import { Request, Response, NextFunction } from 'express';
import { findDir } from './utils/directions'
import { driver } from './db';
import {Neo4jError, Node, Path, PathSegment} from "neo4j-driver"

interface PathNode {
  buildingName: string;
  longitude: number;
  latitude: number;
}

interface RoutePoint extends PathNode {
  floor: string; // SB, 0B, 1, 2...
  nodeType: string; // elevator, building_node, or path
}

// Ordered array of nodes. Order of nodes is the order the user needs to walk
// Need to know whether to omit segments for frontend
interface RouteResult {
  route: RoutePoint[];
  totalDistance: number;
}

/**
 * Retrieves 3 closets nodes to user location.
 * TODO: Add a 4th node that is at least behind the user just in case.
 * - Use vector normalization for better foward measuring
 * - Remove nodes from closest array that are part of immediate path for closer ones.
 * 
 * @returns An array of the 3 closest building nodes in order from closest to furthest
 */
function closestNode(buildings: PathNode[], user_longitude: number, user_latitude: number, targetBuilding: string): PathNode[] | undefined {
  const destination = buildings.find(b => b.buildingName === targetBuilding);
  if (!destination) return undefined;

  const userToDestDist = getPointDistance(user_latitude, user_latitude, destination.longitude, destination.latitude)

  const forwardBuildings = buildings.filter((building => {
    const buildingToDestDist = getPointDistance(building.longitude, building.latitude, destination.longitude, destination.latitude)
    return buildingToDestDist < (userToDestDist * 1.06) // backwards leeway weight 
  }))

  forwardBuildings.sort((a, b) => {
    const distA = Math.hypot(a.longitude - user_longitude, a.latitude - user_latitude);
    const distB = Math.hypot(b.longitude - user_longitude, b.latitude - user_latitude);
    return distA - distB;
  });

  return forwardBuildings.slice(0, 3);
}

/**
 * Computes and returns the full navigable route from a given start location to a target building.
 * 
 * @param coords - The starting location as longitude, latitude coordinates.
 * @param targetDestination - The name of the target building.
 * @returns A array of route objects that the frontend can display.
 */
export async function route(req: Request, res: Response, next: NextFunction) {
  const targetBuilding = String(req.query.targetBuilding);
  const longitude = parseFloat(req.query.longitude as string);
  const latitude = parseFloat(req.query.latitude as string);

  if (!targetBuilding || isNaN(longitude) || isNaN(latitude)) {
    console.error ("Missing target building or coordinates");
    res.status(400).send("Invalid query parameters");
  }

  const session = driver.session({ database: 'neo4j' })

  try {
    const { records: buildingRecords } = await session.executeRead(async tx => {
      return await tx.run(`
        MATCH (start:Node {building_name: $targetBuilding, node_type: "building_node"})
        RETURN start.building_name AS name, start.longitude AS longitude, start.latitude AS latitude
        UNION
        MATCH (start:Node {building_name: $targetBuilding, node_type: "building_node"})
        MATCH path = (start)-[*1..400]-(connected:Node)
        WHERE connected.node_type = "building_node"
        AND connected <> start
        RETURN DISTINCT connected.building_name AS name, connected.longitude AS longitude, connected.latitude AS latitude
        `, { targetBuilding: targetBuilding },
      )
    })
    
    const connectedBuildings = buildingRecords.map(record => ({
      buildingName: record.get("name"),
      longitude: record.get("longitude"),
      latitude: record.get("latitude"),
    }));

    const closeNodes: PathNode[] | undefined = closestNode(connectedBuildings, longitude, latitude, targetBuilding);
    if (!closeNodes || closeNodes.length === 0) {
      res.status(400).send("Bad Request. Could not find route");
      return;
    }
    
    const start: PathNode = closeNodes[0]; // Only using closest node for now

    const { records: pathRecords } = await session.executeRead(async tx => {
      return await tx.run(`
        MATCH (start:Node {building_name: $startName, node_type: 'building_node'})
        WITH start
        MATCH (end:Node {building_name: $endName, node_type: 'building_node'})
        CALL apoc.algo.aStar(
          start, end,
          'CONNECTED_TO',
          'distance', 'latitude', 'longitude'
        )
        YIELD path, weight
        RETURN path, weight
      `, {startName: start.buildingName, endName: targetBuilding});
    });

    const pathRecord = pathRecords[0];
    if (!pathRecord) {
      res.status(404).send("No path found");
      return;
    }

    const path = pathRecord.get("path") as Path;
    const weight = pathRecord.get("weight") as number;

    // Get all nodes in order: [start, segment1.end, segment2.end, ...]
    const nodes: Node[] = [path.start, ...path.segments.map((s: PathSegment) => s.end)];

    const route: RoutePoint[] = nodes.map((node: Node): RoutePoint => ({
      buildingName: node.properties.building_name,
      latitude: node.properties.latitude,
      longitude: node.properties.longitude,
      floor: node.properties.floor,
      nodeType: node.properties.node_type
    }));

    const result: RouteResult = {
      route,
      totalDistance: weight
    };

    res.json(result);
  } catch(err: any) {
    console.log("Error finding Route", err)
    res.status(500).send("Failed finding Route")
  } finally {
    session.close()
  }

}

/**
 * Retrieves all building nodes from the database.
 * 
 * @returns An array of all building nodes with building_name, visits, x, and y.
 */
export async function buildings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { records, summary } = await driver.executeQuery(`
    MATCH (b:Building)
    RETURN b.building_name AS building_name, 
            b.longitude AS longitude, 
            b.latitude AS latitude
    `, {}, { routing: 'READ', database: "neo4j" });

    const buildings: PathNode[] = records.map(record => ({
      buildingName: record.get("building_name"),
      longitude: record.get("longitude"),
      latitude: record.get("latitude"),
    }));

    res.json(buildings);
  } catch (error: any) {
      console.error("Error fetching buildings from database", error);
      res.status(500).send("Error fetching buildings from database");
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

  } catch (err) {
    console.error("popularRoutes failed: ", err);
    res.status(500).send("Failed to query database.");
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
function getPointDistance(x1: number, y1: number, x2: number, y2: number){
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