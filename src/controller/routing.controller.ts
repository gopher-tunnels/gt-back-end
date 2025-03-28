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

/**
 * GET /search
 * Retrieves a list of the closest matching building names 
 *
 * @param req - The request containing the search input from the user.
 * @param res - The response dedicated for the end user 
 * @returns res.json() -> An ordered list of buildings based on % Match to the search input
 */
export async function searchBar(req: Request, res: Response) {
  try {
    // Retrieve the input string from the request
    const input = req.query.input?.toString().trim();

    // If the input doesn't exist, then return empty array
    if (!input) {
      return res.json([]);
    }

    // Send a query to the database for the search results with given input
    const searchResults = await getSearchResults(input);

    // Extract just the names
    const matches = searchResults.map(result => 
      typeof result === 'string' ? result : result.name
    );
    
    // Send all matches 
    res.json(matches); 
       
  } catch (e: any) { // Catching any error, if we want to specialize we could make cases for particular error codes
    // Logging, I would keep this here for debugging purposes
    console.log('Search Error: ', e)

    // Currently I'm assuming that this error will be concerning the database so I'm throwing a 503
    res.status(503).json({
      error: "Error while querying the database",
      details: e.message
    });
  }; 
}

/**
 * Retrieves the closest matching building name based on the search input.
 *
 * @param searchInputText - The partial search input from the user.
 * @returns An ordered list of buildings based on % Match to the search input
 */
async function getSearchResults(searchInputText: string | undefined) {
  // Check if the search input text is valid, if not, return an empty list
  if (!searchInputText) return [];

  // Aggregating query results into a list of a dict containing name and score
  const results: {name: string, score: number}[] = [];

  // Logging for debug purposes
  console.log("Search input text:", searchInputText)

  try {
    // Clean the input text to prevent injection
    const cleanInput = searchInputText?.replace(/"/g, '\\"');

    // Querying neo4j using fuzzy search, obtaining only top 5 results (automatically desc, but I'll make sure)
    const queryResult=await driver.executeQuery(
      `
      CALL db.index.fulltext.queryNodes('BuildingsIndex', $search_input) 
      YIELD node, score 
      RETURN node.building_name AS name, score
      ORDER BY score DESC
      LIMIT 5
      `, {search_input: `"${cleanInput}~"` }
    );

    // Logging for the result records, uncomment for debugging lol
    // console.log(result.records)

    // Populate the results list with name and scores
    queryResult.records.forEach(record => {
      results.push({
        name: record.get('name'),
        score: record.get('score')
      });
    });
  } catch (e) { // Erroring out, assuming it is a database problem
    console.log("Unable to query database, error: ", e);
    throw e;
  }
  return results;
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


// close database connection when app is exited
process.on("exit", async (code) => {
  await driver?.close();
});
