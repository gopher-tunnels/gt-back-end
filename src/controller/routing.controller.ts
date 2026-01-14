import { Request, Response, NextFunction } from 'express';
import { driver } from './db';
import { Neo4jError, Node, Path, PathSegment } from 'neo4j-driver';
import { Unpromisify } from '../utils/types';
import { getCandidateStartNodes } from './utils/closestNodes';
import { haversineDistance } from '../utils/haversine';
import { Coordinates, BuildingNode, RouteStep } from '../types/nodes';
import { getInstruction } from '../utils/routing/getInstruction';
import { processMapboxInstruction } from '../utils/routing/processMapboxInstruction';
import { getMapboxWalkingDirections } from '../services/mapbox';
import {
  fetchConnectedBuildingNodes,
  fetchAllBuildingNodes,
  getDisconnectedBuildingCoords,
  selectOptimalExitNode,
} from '../services/buildings';
import { ROUTING_CONFIG } from '../config/routing';
import { astar } from '../services/astar';
import { incrementBuildingVisit } from '../services/visits';
import { isDisconnectedBuilding } from '../services/isDisconnected';


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
 * Normal case:
 *  - Mapbox: user -> GT start node
 *  - GT (A*): start node -> target building
 *
 * Disconnected_Building case:
 *  - Mapbox: user -> GT start node
 *  - GT (A*): start node -> closest building_node to the disconnected building
 *  - Mapbox: GT end node -> disconnected building
 */
export async function getRoute(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const targetBuilding = String(req.query.targetBuilding);
  const longitude = parseFloat(req.query.longitude as string);
  const latitude = parseFloat(req.query.latitude as string);
  const userLocation: Coordinates = { latitude, longitude };

  if (!targetBuilding || isNaN(longitude) || isNaN(latitude)) {
    console.error('Missing target building or coordinates');
    res.status(400).send('Invalid query parameters');
    return;
  }

  const session = driver.session({ database: 'neo4j' });

  try {
    // --------------------------------------------------
    // 1. Determine if target is a Disconnected_Building
    // --------------------------------------------------
    const disconnected = await isDisconnectedBuilding(session, targetBuilding);

    let routingTargetBuilding = targetBuilding; // building_name we actually route GT to
    let disconnectedCoords: Coordinates | null = null;
    let buildingNodesForRouting: BuildingNode[] = [];

    if (disconnected) {
      // Disconnected target: find its coordinates
      disconnectedCoords = await getDisconnectedBuildingCoords(
        session,
        targetBuilding,
      );
      if (!disconnectedCoords) {
        console.error(
          'Disconnected building has no latitude/longitude:',
          targetBuilding,
        );
        res.status(404).send('Target building not found');
        return;
      }

      // Early exit: if user is very close to disconnected building, skip tunnel
      const directWalkDistKm = haversineDistance(userLocation, disconnectedCoords);
      const directWalkDistMeters = directWalkDistKm * 1000;

      if (directWalkDistMeters < ROUTING_CONFIG.MIN_DIRECT_WALK_METERS) {
        // Return Mapbox-only route, skip tunnel entirely
        try {
          const mapboxDirect = await getMapboxWalkingDirections(
            userLocation,
            disconnectedCoords,
          );

          const leg = mapboxDirect.routes[0].legs[0];
          const directSteps: RouteStep[] = leg.steps.map(
            (step: any, index: number) => ({
              buildingName: '',
              latitude: step.geometry.coordinates[0][1],
              longitude: step.geometry.coordinates[0][0],
              id: `direct-${index}`,
              instruction:
                index < leg.steps.length - 1
                  ? processMapboxInstruction(step.maneuver?.instruction || '')
                  : { type: 'final', label: `Arrive at ${targetBuilding}` },
              floor: '0',
              nodeType: 'sidewalk',
              type: 'mapbox',
            }),
          );

          const result: RouteResult = {
            steps: [{ type: 'mapbox', steps: directSteps }],
            totalDistance: mapboxDirect.routes[0].distance,
            totalTime: mapboxDirect.routes[0].duration,
          };

          await incrementBuildingVisit(session, targetBuilding);
          res.json(result);
          return;
        } catch (err) {
          console.error('Mapbox direct walk failed, falling back to tunnel:', err);
          // Continue with tunnel routing as fallback
        }
      }

      // Use all building_node nodes on campus as potential GT endpoints
      const allBuildingNodes = await fetchAllBuildingNodes(session);
      if (!allBuildingNodes.length) {
        console.error('No building nodes available for routing');
        res.status(404).send('No path found');
        return;
      }

      // Choose optimal GT exit using weighted cost function
      // Balances tunnel distance vs outdoor walking (prefers staying indoors)
      const optimalExit = selectOptimalExitNode(
        allBuildingNodes,
        disconnectedCoords,
        userLocation,
      );

      if (!optimalExit) {
        console.error('Could not find optimal exit node');
        res.status(404).send('No path found');
        return;
      }

      routingTargetBuilding = optimalExit.buildingName;
      buildingNodesForRouting = allBuildingNodes;
    } else {
      // Normal case: use only building nodes connected to the target building
      buildingNodesForRouting = await fetchConnectedBuildingNodes(
        session,
        targetBuilding,
      );

      if (!buildingNodesForRouting.length) {
        console.error(
          'No connected building nodes found for target',
          targetBuilding,
        );
        res.status(404).send('No path found');
        return;
      }
    }

    // --------------------------------------------------
    // 2. Choose GT start node from userLocation
    // --------------------------------------------------
    const candidateStartNodes = getCandidateStartNodes(
      buildingNodesForRouting,
      userLocation,
      routingTargetBuilding,
    );

    if (!candidateStartNodes.length) {
      console.error('No candidate start nodes found for user location');
      res.status(404).send('No path found');
      return;
    }

    const startNode = candidateStartNodes[0]; // closest & best aligned node

    // --------------------------------------------------
    // 3. Mapbox segment 1: user -> GT start
    // --------------------------------------------------
    let mapboxSteps1Raw: { coords: [number, number]; instruction?: string }[] =
      [];
    let mapboxDistance1 = 0;
    let mapboxDuration1 = 0;

    try {
      const mapboxDirections = await getMapboxWalkingDirections(
        { latitude, longitude },
        { latitude: startNode.latitude, longitude: startNode.longitude },
      );

      const leg = mapboxDirections.routes[0].legs[0];

      mapboxSteps1Raw = [
        {
          coords: leg.steps[0]?.geometry?.coordinates?.[0] || [0, 0],
        },
        ...leg.steps.slice(0, -1).map((step: any) => ({
          coords: step?.geometry?.coordinates?.[1] || [0, 0],
          instruction: step?.maneuver?.instruction,
        })),
      ];

      mapboxDistance1 = mapboxDirections.routes[0].distance;
      mapboxDuration1 = mapboxDirections.routes[0].duration;
    } catch (err) {
      console.error('Mapbox Directions API (segment 1) failed:', err);
      // Still continue with GT-only routing if needed
    }

    const mapboxSteps1: RouteStep[] = mapboxSteps1Raw.map(
      ({ coords }, index) => ({
        buildingName: '',
        latitude: coords[1],
        longitude: coords[0],
        id: JSON.stringify(coords),
        instruction:
          index !== mapboxSteps1Raw.length - 1
            ? processMapboxInstruction(
                mapboxSteps1Raw[index + 1]?.instruction || '',
              )
            : {
                type: 'final',
                label: 'Continue through the GopherWay',
              },
        floor: '0',
        nodeType: 'sidewalk',
        type: 'mapbox',
      }),
    );

    // --------------------------------------------------
    // 4. GT segment: A* from startNode -> routingTargetBuilding
    // --------------------------------------------------
    const astarResult = await astar(
      session,
      startNode.buildingName,
      routingTargetBuilding,
    );

    if (!astarResult) {
      console.error('A* could not find a path');
      res.status(404).send('No path found');
      return;
    }

    const { steps: gtSteps, weight } = astarResult;

    // --------------------------------------------------
    // 5. Optional Mapbox segment 2: GT end -> disconnected building
    // --------------------------------------------------
    let mapboxSteps2: RouteStep[] = [];
    let mapboxDistance2 = 0;
    let mapboxDuration2 = 0;

    if (disconnected && disconnectedCoords && gtSteps.length > 0) {
      const lastGtStep = gtSteps[gtSteps.length - 1];

      try {
        const mapboxDirections2 = await getMapboxWalkingDirections(
          {
            latitude: lastGtStep.latitude,
            longitude: lastGtStep.longitude,
          },
          {
            latitude: disconnectedCoords.latitude,
            longitude: disconnectedCoords.longitude,
          },
        );

        const leg2 = mapboxDirections2.routes[0].legs[0];

        const rawSteps2 = [
          {
            coords: leg2.steps[0]?.geometry?.coordinates?.[0] || [0, 0],
          },
          ...leg2.steps.slice(0, -1).map((step: any) => ({
            coords: step?.geometry?.coordinates?.[1] || [0, 0],
            instruction: step?.maneuver?.instruction,
          })),
        ];

        mapboxSteps2 = rawSteps2.map(({ coords }, index) => ({
          buildingName: '',
          latitude: coords[1],
          longitude: coords[0],
          id: JSON.stringify(coords),
          instruction:
            index !== rawSteps2.length - 1
              ? processMapboxInstruction(
                  rawSteps2[index + 1]?.instruction || '',
                )
              : {
                  type: 'final',
                  label: `Walk to ${targetBuilding}`,
                },
          floor: '0',
          nodeType: 'sidewalk',
          type: 'mapbox',
        }));

        mapboxDistance2 = mapboxDirections2.routes[0].distance;
        mapboxDuration2 = mapboxDirections2.routes[0].duration;
      } catch (err) {
        console.error('Mapbox Directions API (segment 2) failed:', err);
      }
    }

    // --------------------------------------------------
    // 6. Aggregate steps: mapbox1 -> GT -> (optional) mapbox2
    // --------------------------------------------------
    const steps: { type: string; steps: RouteStep[] }[] = [
      {
        type: 'mapbox',
        steps: mapboxSteps1,
      },
      {
        type: 'GT',
        steps: gtSteps,
      },
    ];

    if (mapboxSteps2.length > 0) {
      steps.push({
        type: 'mapbox',
        steps: mapboxSteps2,
      });
    }

    // --------------------------------------------------
    // 7. Aggregate distance / time
    // --------------------------------------------------
    const result: RouteResult = {
      steps,
      totalDistance: weight + mapboxDistance1 + mapboxDistance2,
      totalTime:
        Math.round(weight / 1.4) + mapboxDuration1 + mapboxDuration2,
    };

    // --------------------------------------------------
    // 8. Increment visits for the *target* building name
    // --------------------------------------------------
    await incrementBuildingVisit(session, targetBuilding);

    res.json(result);
  } catch (err: any) {
    console.log('Error finding Route', err);
    res.status(500).send('Failed finding Route');
  } finally {
    await session.close();
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
      MATCH (b)
      WHERE b:Building OR b:Disconnected_Building
      RETURN  id(b) AS id, 
              b.building_name AS building_name, 
              b.address AS address,
              b.opens AS opens,
              b.closes AS closes,
              b.longitude AS longitude, 
              b.latitude AS latitude,
              b:Disconnected_Building AS is_disconnected
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
      isDisconnected: record.get('is_disconnected') === true,
    }));

    res.json(buildings);
  } catch (err: any) {
    console.error('Error fetching buildings from database', err);
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
  } catch (err: any) {
    // Catching any error, if we want to specialize we could make cases for particular error codes
    // Logging, I would keep this here for debugging purposes
    console.log('Search Error: ', err);

    // Currently I'm assuming that this error will be concerning the database so I'm throwing a 503
    res.status(503).json({
      error: 'Error while querying the database',
      details: err.message,
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
  } catch (err) {
    // Erroring out, assuming it is a database problem
    console.log('Error querying database: ', err);
    throw err;
  }
  return results;
}
