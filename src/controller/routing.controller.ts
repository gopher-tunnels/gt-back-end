import { Request, Response, NextFunction } from 'express';
import { driver } from './db';
import { Neo4jError, Node, Path, PathSegment } from 'neo4j-driver';
import { Unpromisify } from '../utils/types';
import { getCandidateStartNodes } from './utils/closestNodes';
import { BuildingNode, RouteStep } from '../types/nodes';
import { getInstruction } from '../utils/routing/getInstruction';
import { processMapboxInstruction } from '../utils/routing/processMapboxInstruction';
import { getMapboxWalkingDirections } from '../services/mapbox';

// the units of the distance is meters
//the units of the time is seconds
interface RouteResult {
  steps: { type: string; steps: RouteStep[] }[]; // In order of the path.
  totalDistance: number;
  totalTime: number;
}

/**
 * POST /route
 * Computes and returns the full navigable route from a given start location to a target building.
 *
 * TODO:
 *  - Handle Edge Cases: Close to destination, same coordinates as destination*, Not on campus, no buildings in front.
 *  - Figure out if update visits write query should be in a new transaction.
 *
 * @param coords - The starting location as longitude, latitude coordinates.
 * @param targetDestination - The name of the target building.
 * @returns A array of route objects that the frontend can display.
 */
export async function getRoute(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const targetBuilding = String(req.query.targetBuilding);
  const longitude = parseFloat(req.query.longitude as string);
  const latitude = parseFloat(req.query.latitude as string);
  const userLocation = { latitude, longitude };

  if (!targetBuilding || isNaN(longitude) || isNaN(latitude)) {
    console.error('Missing target building or coordinates');
    res.status(400).send('Invalid query parameters');
  }

  const session = driver.session({ database: 'neo4j' });
  try {
    const { records: buildingRecords } = await session.executeRead(
      async (tx) => {
        return await tx.run(
          `
          MATCH (start:Node {building_name: $targetBuilding, node_type: "building_node"})
          RETURN 
            id(start) AS id,
            start.building_name AS name, 
            start.longitude AS longitude, 
            start.latitude AS latitude

          UNION

          MATCH (start:Node {building_name: $targetBuilding, node_type: "building_node"})
          MATCH path = (start)-[*1..400]-(connected:Node)
          WHERE connected.node_type = "building_node" AND connected <> start
          RETURN DISTINCT 
            id(connected) AS id,
            connected.building_name AS name, 
            connected.longitude AS longitude, 
            connected.latitude AS latitude
          `,
          { targetBuilding },
        );
      },
    );

    const connectedBuildings: BuildingNode[] = buildingRecords.map(
      (record) => ({
        buildingName: record.get('name'),
        longitude: record.get('longitude'),
        latitude: record.get('latitude'),
        id: record.get('id').toNumber(),
      }),
    );

    const candidateStartNodes = getCandidateStartNodes(
      connectedBuildings,
      userLocation,
      targetBuilding,
    );

    const startNode = candidateStartNodes[0]; // Grab closest candidate node for now
    // Initialize an empty array for aggregating steps associated to mapbox
    let mapboxSteps: { coords: [number, number]; instruction?: string }[] = [];
    let mapboxDuration = 0;
    let mapboxDistance = 0;
    // Try block for the external direction services; if they fail, keep routing via Neo4j only
    try {
      const mapboxDirections = await getMapboxWalkingDirections(
        { latitude, longitude },
        { latitude: startNode.latitude, longitude: startNode.longitude },
      );

      mapboxSteps = [
        {
          coords: mapboxDirections.routes[0].legs[0].steps[0]?.geometry
            ?.coordinates?.[0] || [0, 0],
        },
        ...mapboxDirections.routes[0].legs[0].steps
          .slice(0, -1)
          .map((step: any) => ({
            coords: step?.geometry?.coordinates?.[1] || [0, 0],
            instruction: step?.maneuver?.instruction,
          })),
      ];
      mapboxDistance = mapboxDirections.routes[0].distance;
      mapboxDuration = mapboxDirections.routes[0].duration;
    } catch (err) {
      console.error('Mapbox Directions API failed:', err);
      // Proceed with Neo4j-only route if Mapbox fails
    }

    const { records: pathRecords } = await session.executeRead(async (tx) => {
      return await tx.run(
        `
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
      `,
        { startName: startNode.buildingName, endName: targetBuilding },
      );
    });

    const pathRecord = pathRecords[0];
    if (!pathRecord) {
      res.status(404).send('No path found');
      return;
    }

    const path = pathRecord.get('path') as Path;
    const weight = pathRecord.get('weight') as number;

    // Get all nodes in order: [start, segment1.end, segment2.end, ...]
    const nodes: Node[] = [
      path.start,
      ...path.segments.map((s: PathSegment) => s.end),
    ];

    // Aggregate both Mapbox-generated step info and Neo4j-generated step info together into steps
    const steps: { type: string; steps: RouteStep[] }[] = [
      {
        type: 'mapbox',
        steps: mapboxSteps.map(({ coords, instruction }, index) => ({
          buildingName: '',
          latitude: coords[1],
          longitude: coords[0],
          id: JSON.stringify(coords),
          instruction:
            index != mapboxSteps.length - 1
              ? processMapboxInstruction(
                  mapboxSteps[index + 1]?.instruction || '',
                )
              : {
                  type: 'final',
                  label: 'Continue through the GopherWay',
                },
          floor: '0',
          nodeType: 'sidewalk',
          type: 'mapbox',
        })),
      },
      {
        type: 'GT',
        steps: nodes.map(
          (node: Node, index): RouteStep => ({
            instruction: getInstruction(node, index, nodes),
            buildingName: node.properties.building_name,
            latitude: node.properties.latitude,
            longitude: node.properties.longitude,
            id: node.identity.toNumber(),
            floor: node.properties.floor,
            nodeType: node.properties.node_type,
            type: 'GT',
          }),
        ),
      },
    ];

    // Aggregate steps, total distance, and total time together
    const result: RouteResult = {
      steps,
      totalDistance: weight + mapboxDistance,
      totalTime: Math.round(weight / 1.4) + mapboxDuration,
    };

    // Move to a new transaction in case it can't write for some reason.
    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        MATCH (b:Building {building_name: $name})
        WHERE datetime().epochSeconds - coalesce(b.lastUpdated.epochSeconds, 0) >= 60
        SET b.visits = b.visits + 1,
        b.lastUpdated = datetime()
      `,
        { name: targetBuilding },
      );
    });

    res.json(result);
  } catch (err: any) {
    console.log('Error finding Route', err);
    res.status(500).send('Failed finding Route');
  } finally {
    session.close();
  }
}

/**
 * GET /buildings
 * Retrieves all building nodes from the database.
 *
 * @returns An array of all building nodes with building_name, visits, x, and y.
 */
export async function getAllBuildings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { records, summary } = await driver.executeQuery(
      `
      MATCH (b:Building)
      RETURN  id(b) AS id, 
              b.building_name AS building_name, 
              b.address AS address,
              b.opens AS opens,
              b.closes AS closes,
              b.longitude AS longitude, 
              b.latitude AS latitude
    `,
      {},
      { routing: 'READ', database: 'neo4j' },
    );

    const buildings: BuildingNode[] = records.map((record) => ({
      buildingName: record.get('building_name'),
      address: record.get('address'),
      opens: record.get('opens'),
      closes: record.get('closes'),
      longitude: record.get('longitude'),
      latitude: record.get('latitude'),
      id: record.get('id').toNumber(),
    }));

    res.json(buildings);
  } catch (error: any) {
    console.error('Error fetching buildings from database', error);
    res.status(500).send('Error fetching buildings from database');
  }
}

/**
 * GET /popular
 * Retrieves the five most popular buildings based on visit counts.
 *
 * TODO:
 *  - Add protection against visits update spam in getRoute.
 *  - What if we just returned the popular buildings for the user? Suggestion
 *
 * @returns An array of up to five building names, ordered by popularity.
 */
export async function getPopularBuildings(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    let { records, summary } = await driver.executeQuery(
      `
      MATCH (b:Building)
      RETURN 
        id(b)           AS id,
        b.building_name AS buildingName,
        b.visits        AS visits,
        b.latitude      AS latitude,
        b.longitude     AS longitude
      ORDER BY visits DESC
      LIMIT 5
      `,
      {},
      { routing: 'READ', database: 'neo4j' },
    );

    const popularBuildings = records.map((r) => ({
      id: r.get('id').toNumber(),
      buildingName: r.get('buildingName'),
      visits: r.get('visits'),
      latitude: r.get('latitude'),
      longitude: r.get('longitude'),
    }));

    res.json(popularBuildings);
  } catch (err) {
    console.error('popularRoutes failed: ', err);
    res.status(500).send('Failed to find popular routes.');
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
export async function searchBuildings(req: Request, res: Response) {
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
    node: any;
    score: number;
  }[]
> {
  // Check if the search input text is valid, if not, return an empty list
  if (!searchInputText) return [];

  // Aggregating query results into a list of a dict containing name and score
  const results = [] as Unpromisify<ReturnType<typeof getSearchResults>>;

  // Logging for debug purposes
  // console.log('Search input text:', searchInputText);

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
      const node = record.get('node') as Node;
      const score = record.get('score');

      results.push({
        node: {
          buildingName: node.properties.building_name,
          address: node.properties.address,
          latitude: node.properties.latitude,
          longitude: node.properties.longitude,
          id: node.identity.toNumber(),
        },
        score: score,
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
