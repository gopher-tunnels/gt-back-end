import { Request, Response, NextFunction } from 'express';
import { driver } from './db';
import { Node } from 'neo4j-driver';
import { getCandidateStartNodes } from '../utils/routing/closestNodes';
import { Coordinates, BuildingNode } from '../types/nodes';
import { incrementBuildingVisit } from '../services/visits';
import { getBuildingCoords } from '../services/buildings';
import { getAllNodes, getNode, findRoute, getGraphInfo } from '../services/multiLayerGraph';
import { type RoutingPreference } from '../config/routing';
import { haversineDistance } from '../utils/math';
import {
  aggregateRoute,
  buildMapboxSegment,
  handleDirectWalk,
  findUserInsideBuilding,
  type ExecutedSegment,
} from '../services/routeBuilder';
import { ROUTING_CONFIG } from '../config/routing';

/**
 * GET /route
 * Computes a navigation route using the precomputed multilayer graph.
 *
 * Flow:
 *  1. Direct walk if user < 100m from target
 *  2. Determine start building_node (inside building or nearest candidate)
 *  3. Run Dijkstra on multilayer graph (tunnel + outdoor layers)
 *  4. Execute each segment: tunnel → cached steps, outdoor → Mapbox
 *  5. If target has no building_node, append final Mapbox leg to target coords
 */
export async function getRoute(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const targetBuilding = String(req.query.targetBuilding);
  const longitude = parseFloat(req.query.longitude as string);
  const latitude = parseFloat(req.query.latitude as string);
  const preference = (req.query.preference as RoutingPreference) ?? ROUTING_CONFIG.DEFAULT_PREFERENCE;
  const userLocation: Coordinates = { latitude, longitude };

  if (!targetBuilding || isNaN(longitude) || isNaN(latitude)) {
    res.status(400).send('Invalid query parameters');
    return;
  }

  const session = driver.session({ database: 'neo4j' });

  try {
    const targetCoords = await getBuildingCoords(session, targetBuilding);
    if (!targetCoords) {
      res.status(404).send('Building not found');
      return;
    }

    // 1. Direct walk
    const directWalk = await handleDirectWalk(session, userLocation, targetCoords, targetBuilding);
    if (directWalk) { res.json(directWalk); return; }

    const allNodes = getAllNodes();

    // 2. Determine start node
    const insideBuilding = findUserInsideBuilding(allNodes, userLocation);
    const skipInitialMapbox = !!insideBuilding;

    // Ensure target exists in node list for getCandidateStartNodes
    const syntheticTarget: BuildingNode = { buildingName: targetBuilding, ...targetCoords, id: 'synthetic' };
    const nodesForSelection = getNode(targetBuilding) ? allNodes : [...allNodes, syntheticTarget];

    const startNodeName = insideBuilding
      ? insideBuilding.buildingName
      : getCandidateStartNodes(nodesForSelection, userLocation, targetBuilding)[0]?.buildingName;

    if (!startNodeName) {
      res.status(404).send('No path found');
      return;
    }

    // 3. Route target — if building has no building_node, route to nearest node then Mapbox to target
    const targetInGraph = !!getNode(targetBuilding);
    const routeTarget = targetInGraph
      ? targetBuilding
      : allNodes.reduce((best, n) =>
          haversineDistance(n, targetCoords) < haversineDistance(best, targetCoords) ? n : best,
        ).buildingName;

    // 4. Dijkstra on multilayer graph
    const routeSegments = findRoute(startNodeName, routeTarget, preference);
    if (!routeSegments) {
      res.status(404).send('No path found');
      return;
    }

    // 5. Execute segments
    const executed: ExecutedSegment[] = [];

    // Initial Mapbox: user -> first building_node (skip if user is inside)
    if (!skipInitialMapbox) {
      const firstNode = routeSegments.length > 0 ? routeSegments[0].from : getNode(routeTarget)!;
      const seg = await buildMapboxSegment(
        userLocation,
        firstNode,
        { type: 'enter', label: 'Enter the GopherWay' },
      );
      if (seg) executed.push({ type: 'mapbox', ...seg });
    }

    for (let i = 0; i < routeSegments.length; i++) {
      const segment = routeSegments[i];
      if (segment.type === 'tunnel') {
        const prevWasTunnel = routeSegments[i - 1]?.type === 'tunnel';
        const nextIsAlsoTunnel = routeSegments[i + 1]?.type === 'tunnel';

        let steps = segment.steps!;
        if (prevWasTunnel || nextIsAlsoTunnel) {
          steps = steps.map((s, idx) => {
            if (idx === 0 && prevWasTunnel)
              return { ...s, instruction: { type: 'forward' as const, label: 'Continue through the GopherWay' } };
            if (idx === steps.length - 1 && nextIsAlsoTunnel)
              return { ...s, instruction: { type: 'forward' as const, label: 'Continue through the GopherWay' } };
            return s;
          });
        }

        executed.push({
          type: 'GT',
          steps,
          distance: segment.cost,
          duration: Math.round(segment.cost / ROUTING_CONFIG.WALKING_SPEED_MPS),
        });
      } else {
        const distMeters = haversineDistance(segment.from, segment.to) * 1000;
        if (distMeters < ROUTING_CONFIG.MIN_MAPBOX_SEGMENT_METERS) {
          executed.push({
            type: 'mapbox',
            steps: [
              { ...segment.from, buildingName: '', id: `${segment.from.longitude},${segment.from.latitude}`, instruction: { type: 'forward' as const, label: 'Continue walking' }, floor: '0', nodeType: 'sidewalk', type: 'mapbox' },
              { ...segment.to, buildingName: '', id: `${segment.to.longitude},${segment.to.latitude}`, instruction: { type: 'forward' as const, label: 'Continue walking' }, floor: '0', nodeType: 'sidewalk', type: 'mapbox' },
            ],
            distance: distMeters,
            duration: Math.round(distMeters / ROUTING_CONFIG.WALKING_SPEED_MPS),
          });
        } else {
          const seg = await buildMapboxSegment(
            segment.from,
            segment.to,
            { type: 'forward', label: 'Continue walking' },
          );
          if (seg) executed.push({ type: 'mapbox', ...seg });
        }
      }
    }

    // Final Mapbox leg for buildings not in the graph
    if (!targetInGraph) {
      const lastNode = routeSegments.length > 0
        ? routeSegments[routeSegments.length - 1].to
        : getNode(routeTarget)!;
      const seg = await buildMapboxSegment(
        lastNode,
        targetCoords,
        { type: 'final', label: `Walk to ${targetBuilding}` },
      );
      if (seg) executed.push({ type: 'mapbox', ...seg });
    }

    const result = aggregateRoute(executed);
    await incrementBuildingVisit(session, targetBuilding);
    res.json(result);
  } catch (err: any) {
    console.error(`[ERROR] Route failed: ${err.message}`);
    res.status(500).send('Failed finding Route');
  } finally {
    await session.close();
  }
}

/**
 * GET /buildings
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

    res.json(records.map((record) => ({
      buildingName: record.get('building_name'),
      address: record.get('address'),
      opens: record.get('opens'),
      closes: record.get('closes'),
      longitude: record.get('longitude'),
      latitude: record.get('latitude'),
      id: record.get('id').toNumber(),
      isDisconnected: record.get('is_disconnected') === true,
    })));
  } catch (err: any) {
    console.error('Error fetching buildings from database', err);
    res.status(500).send('Error fetching buildings from database');
  }
}

/**
 * GET /popular
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

    res.json(records.map((r) => ({
      id: r.get('id').toNumber(),
      buildingName: r.get('buildingName'),
      visits: r.get('visits'),
      latitude: r.get('latitude'),
      longitude: r.get('longitude'),
    })));
  } catch (err) {
    console.error('popularRoutes failed: ', err);
    res.status(500).send('Failed to find popular routes.');
  }
}

/**
 * GET /search
 */
export async function searchBuildings(req: Request, res: Response) {
  try {
    const input = req.query.input?.toString().trim();
    if (!input) return res.json([]);

    const cleanInput = input.replace(/"/g, '\\"');
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

    res.status(200).json(
      queryResult.records.map((record) => {
        const node = record.get('node') as Node;
        return {
          buildingName: node.properties.building_name,
          address: node.properties.address,
          latitude: node.properties.latitude,
          longitude: node.properties.longitude,
          id: node.identity.toNumber(),
        };
      }),
    );
  } catch (err: any) {
    console.log('Search Error: ', err);
    res.status(503).json({ error: 'Error while querying the database', details: err.message });
  }
}

/**
 * GET /graph
 */
export function getGraphStatus(_req: Request, res: Response) {
  res.json(getGraphInfo());
}
