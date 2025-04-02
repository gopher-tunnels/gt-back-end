import { Request, Response, NextFunction } from 'express';
import { findDir } from './utils/directions';
import { driver } from './db';
import {Neo4jError, Node, Path, PathSegment} from "neo4j-driver"
import { Vertex } from '../types/db';
import { Unpromisify } from '../utils/types';

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

    // May need to move this to its own transaction
    // Just so a route is still returned if it cant write for some reason.
    await session.executeWrite(async tx => {
      await tx.run(`
        MATCH (b:Building {building_name: $name})
        SET b.visits = b.visits + 1
      `, { name: targetBuilding });
    });

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

/**
 * Retrieves the five most popular buildings based on visit counts.
 *
 * @returns An array of up to five building names, ordered by popularity.
 */
export async function popular(req: Request, res: Response, next: NextFunction) {
  try {
    let { records, summary } = await driver.executeQuery(`
      MATCH (b:Building)
      RETURN b.building_name AS building_name, b.visits AS visits
      ORDER BY visits DESC
      LIMIT 5
    `, {}, { routing: 'READ', database: "neo4j" });

    const popularBuildings = records.map(record => ({
      buildingName: record.get("building_name"),
    }))

    res.json(popularBuildings);
  } catch (err) {
    console.error("popularRoutes failed: ", err);
    res.status(500).send("Failed to find popular routes.");
  }
}

/**
 * GET /search
 * Retrieves a list of the closest matching buildings
 *
 * @param req - The request containing the search input from the user.
 * @param res - The response the server will send back
 * @returns res.json() -> An ordered list of buildings based on % Match to the search input
 */
export async function buildingSearch(req: Request, res: Response) {
  try {
    // Retrieve the input string from the request
    const input = req.query.input?.toString().trim();

    // If the input doesn't exist, then return empty array
    if (!input) {
      return res.json([]);
    }

    // Send a query to the database for the search results with given input
    const searchResults = await getSearchResults(input);

    // Extract just the node info
    const matches = searchResults.map((result) =>
      typeof result === 'string' ? result : result.node,
    );

    // Send all matches with 200 status code
    res.status(200).json(matches);
  } catch (e: any) {
    // Catching any error, if we want to specialize we could make cases for particular error codes
    // Logging, I would keep this here for debugging purposes
    console.log('Search Error: ', e);

    // Currently I'm assuming that this error will be concerning the database so I'm throwing a 503
    res.status(503).json({
      error: 'Error while querying the database',
      details: e.message,
    });
  }
}

/**
 * Retrieves the closest matching building name based on the search input.
 *
 * @param searchInputText - The partial search input from the user.
 * @returns An ordered list of buildings based on % Match to the search input
 */
async function getSearchResults(searchInputText: string | undefined): Promise<
  {
    node: Vertex;
    score: number;
  }[]
> {
  // Check if the search input text is valid, if not, return an empty list
  if (!searchInputText) return [];

  // Aggregating query results into a list of a dict containing name and score
  const results = [] as Unpromisify<ReturnType<typeof getSearchResults>>;

  // Logging for debug purposes
  console.log('Search input text:', searchInputText);

  try {
    // Clean the input text to prevent injection
    const cleanInput = searchInputText?.replace(/"/g, '\\"');

    // Querying neo4j using fuzzy search, obtaining only top 5 results (automatically desc, but I'll make sure)
    const queryResult = await driver.executeQuery(
      `
      CALL db.index.fulltext.queryNodes('BuildingsIndex', $search_input) 
      YIELD node, score 
      RETURN node, score
      ORDER BY score DESC
      LIMIT 5
      `,
      { search_input: `\\"${cleanInput}~\\"` },
    );

    // Logging for the result records, uncomment for debugging lol
    // console.log(queryResult.records)

    // Populate the results list with node info and scores
    queryResult.records.forEach((record) => {
      results.push({
        node: record.get('node'),
        score: record.get('score'),
      });
    });

    // Logging for the building nodes + scores
    // console.log(results);
  } catch (e) {
    // Erroring out, assuming it is a database problem
    console.log('Error querying database: ', e);
    throw e;
  }
  return results;
}

// returns Haversine distance between two geopositions
function getPointDistance(x1: number, y1: number, x2: number, y2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;

  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(y2 - y1);
  const dLon = toRad(x2 - x1);
  const lat1 = toRad(y1);
  const lat2 = toRad(y2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// close database connection when app is exited
process.on('exit', async (code) => {
  await driver?.close();
});
