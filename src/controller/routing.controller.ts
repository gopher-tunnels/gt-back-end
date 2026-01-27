import { Request, Response, NextFunction } from 'express';
import { driver } from './db';
import { Node } from 'neo4j-driver';
import { getCandidateStartNodes } from '../utils/routing/closestNodes';
import { Coordinates, BuildingNode } from '../types/nodes';
import { astar } from '../services/astar';
import { incrementBuildingVisit } from '../services/visits';
import { isDisconnectedBuilding, getBuildingCoords } from '../services/buildings';
import {
  aggregateRoute,
  buildMapboxSegment,
  resolveConnectedTarget,
  resolveDisconnectedTarget,
  handleDirectWalk,
  findUserInsideBuilding,
  type MapboxSegmentResult,
} from '../services/routeBuilder';

/**
 * GET /route
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

  console.log("Routing to building:", targetBuilding);

  if (!targetBuilding || isNaN(longitude) || isNaN(latitude)) {
    console.error('Missing target building or coordinates');
    res.status(400).send('Invalid query parameters');
    return;
  }

  const session = driver.session({ database: 'neo4j' });

  try {
    // 1. Determine if target is a Disconnected_Building
    const disconnected = await isDisconnectedBuilding(session, targetBuilding);
    console.log("disconnected: ", disconnected)

    // 2. Get target building coordinates (works for both connected and disconnected)
    const targetCoords = await getBuildingCoords(session, targetBuilding);

    // 3. Resolve routing parameters based on building type
    let routingTargetBuilding: string;
    let buildingNodesForRouting: BuildingNode[];
    let disconnectedCoords: Coordinates | null = null;

    if (disconnected) {
      const disconnectedResult = await resolveDisconnectedTarget(session, targetBuilding, userLocation, targetCoords);
      if (!disconnectedResult) {
        res.status(404).send('No path found');
        return;
      }

      disconnectedCoords = disconnectedResult.disconnectedCoords;
      routingTargetBuilding = disconnectedResult.routingTargetBuilding;
      buildingNodesForRouting = disconnectedResult.buildingNodesForRouting;
    } else {
      const connectedResult = await resolveConnectedTarget(session, targetBuilding);
      if (!connectedResult) {
        res.status(404).send('No path found');
        return;
      }
      routingTargetBuilding = connectedResult.routingTargetBuilding;
      buildingNodesForRouting = connectedResult.buildingNodesForRouting;
    }

    // 4. Check if user is inside a building (within ~25m of a building_node)
    const insideBuilding = findUserInsideBuilding(buildingNodesForRouting, userLocation);

    // 5. Check if user is close enough for direct walk
    // Skip direct walk if user is inside a connected building going to another connected building
    // (they should use the tunnel instead of going outside)
    const shouldSkipDirectWalk = insideBuilding && !disconnected;

    if (targetCoords && !shouldSkipDirectWalk) {
      const directWalkResult = await handleDirectWalk(
        session,
        userLocation,
        targetCoords,
        targetBuilding,
      );
      if (directWalkResult) {
        res.json(directWalkResult);
        return;
      }
    }

    // 6. Determine start node and whether to skip initial Mapbox segment (tunnel entry)
    let startNode: BuildingNode;
    let skipInitialMapbox = false;

    if (insideBuilding) {
      // User is inside a building - start from that building's tunnel entrance
      startNode = insideBuilding;
      skipInitialMapbox = true;
      console.log(`User is inside building: ${insideBuilding.buildingName}, starting from tunnel`);
    } else {
      // User is outside - find best start node
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

      startNode = candidateStartNodes[0];
    }

    // 7. Mapbox segment 1: user -> GT start (skip if user is inside a building)
    const mapboxSegment1: MapboxSegmentResult = skipInitialMapbox
      ? { steps: [], distance: 0, duration: 0 }
      : (await buildMapboxSegment(
          userLocation,
          { latitude: startNode.latitude, longitude: startNode.longitude },
          { type: 'final', label: 'Continue through the GopherWay' },
        ) ?? { steps: [], distance: 0, duration: 0 });

    // 8. GT segment: A* from startNode -> routingTargetBuilding
    console.log("A* start:", startNode.buildingName, "end:", routingTargetBuilding);
    const astarResult = await astar(session, startNode.buildingName, routingTargetBuilding);
    if (!astarResult) {
      console.error('A* could not find a path');
      res.status(404).send('No path found');
      return;
    }

    const { steps: gtSteps, weight } = astarResult;

    // 9. Optional Mapbox segment 2: GT end -> disconnected building
    let mapboxSegment2: MapboxSegmentResult | null = null;
    if (disconnected && disconnectedCoords && gtSteps.length > 0) {
      const lastGtStep = gtSteps[gtSteps.length - 1];
      mapboxSegment2 = await buildMapboxSegment(
        { latitude: lastGtStep.latitude, longitude: lastGtStep.longitude },
        disconnectedCoords,
        { type: 'final', label: `Walk to ${targetBuilding}` },
      );
    }

    // 10. Aggregate and respond
    const result = aggregateRoute(mapboxSegment1, gtSteps, weight, mapboxSegment2);
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
    const { records } = await driver.executeQuery(
      `
      MATCH (b:Building)
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
    const { records } = await driver.executeQuery(
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
  const results: Awaited<ReturnType<typeof getSearchResults>> = [];

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
