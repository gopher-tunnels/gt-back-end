import { Request, Response, NextFunction } from 'express';
import { driver } from './db';
import { Node } from 'neo4j-driver';
import { Coordinates, BuildingNode } from '../types/nodes';
import { InstructionType, SegmentType } from '../types/route';
import { getAllNodes, getNode, getDisconnectedBuilding, findRoute, getGraphInfo, GraphLayerType } from '../services/multiLayerGraph';
import { RoutingPreference, OUTDOOR_PENALTY_BY_PREFERENCE, ROUTING_CONFIG } from '../config/routing';
import { haversineDistance } from '../utils/math';
import type { ExecutedSegment, RouteSegment } from '../types/route';
import { aggregateRoute, buildMapboxSegment, handleDirectWalk, findUserInsideBuilding } from '../services/routeBuilder';
import { incrementBuildingVisit } from '../services/visits';
import { isWriteAvailable } from './db';

const fmt = (c: Coordinates) => `${c.longitude}, ${c.latitude}`;

function mapboxCoords(node: BuildingNode, reference: Coordinates): Coordinates {
  if (!node.entranceNodes?.length) return node;
  return node.entranceNodes.reduce((best, e) =>
    haversineDistance(e, reference) < haversineDistance(best, reference) ? e : best,
  );
}

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
  const rawPreference = req.query.preference as string;
  const preference: RoutingPreference = Object.values(RoutingPreference).includes(rawPreference as RoutingPreference)
    ? (rawPreference as RoutingPreference)
    : ROUTING_CONFIG.DEFAULT_PREFERENCE;
  const userLocation: Coordinates = { latitude, longitude };

  if (!targetBuilding || isNaN(longitude) || isNaN(latitude)) {
    res.status(400).send('Invalid query parameters');
    return;
  }

  const session = driver.session({ database: 'neo4j' });

  try {
    const targetNode = getNode(targetBuilding) ?? getDisconnectedBuilding(targetBuilding);
    if (!targetNode) {
      res.status(404).send('Building not found');
      return;
    }
    const targetCoords: Coordinates = targetNode;

    // 1. Direct walk
    const directWalk = await handleDirectWalk(session, userLocation, targetCoords, targetBuilding);
    if (directWalk) {
      console.log(`[Route] ═══ ${targetBuilding} | direct walk ═══`);
      console.log(`[Route]   from  ${fmt(userLocation)}`);
      console.log(`[Route]   to    ${fmt(targetCoords)}`);
      res.json(directWalk);
      return;
    }

    const allNodes = getAllNodes();

    // 2. Check if user is inside a building
    const insideBuilding = findUserInsideBuilding(allNodes, userLocation);
    const skipInitialMapbox = !!insideBuilding;

    // 3. Route target — if building has no building_node, route to nearest node then Mapbox to target
    const targetInGraph = !!getNode(targetBuilding);
    const routeTarget = targetInGraph
      ? targetBuilding
      : allNodes.reduce((best, n) =>
          haversineDistance(n, targetCoords) < haversineDistance(best, targetCoords) ? n : best,
        ).buildingName;

    // 4. Find best start node + route: minimize haversine(user→node)*penalty + routeCost(node→target)
    // This prevents picking a close-but-wrong-direction node that leads to a much longer tunnel path.
    const outdoorPenalty = OUTDOOR_PENALTY_BY_PREFERENCE[preference];
    let startNodeName = insideBuilding?.buildingName ?? '';
    let routeSegments: RouteSegment[] | null = insideBuilding
      ? findRoute(insideBuilding.buildingName, routeTarget, preference)
      : null;

    if (!insideBuilding) {
      let bestCost = Infinity;
      for (const node of allNodes) {
        const segments = findRoute(node.buildingName, routeTarget, preference);
        if (!segments) continue;
        const walkCost = haversineDistance(node, userLocation) * 1000 * outdoorPenalty;
        const routeCost = segments.reduce((sum, s) => sum + s.cost, 0);
        const total = walkCost + routeCost;
        if (total < bestCost) {
          bestCost = total;
          startNodeName = node.buildingName;
          routeSegments = segments;
        }
      }
    }

    if (!startNodeName || !routeSegments) {
      res.status(404).send('No path found');
      return;
    }

    const pathStr = routeSegments.length === 0
      ? `${startNodeName} → ${routeTarget}`
      : routeSegments.map((s, i) =>
          `${i === 0 ? s.from.buildingName : ''} [${s.type} ${Math.round(s.cost)}m] → ${s.to.buildingName}`
        ).join(' ');

    console.log(`[Route] ═══ ${targetBuilding} | ${preference} ═══`);
    console.log(`[Route]   user:   ${fmt(userLocation)}`);
    console.log(`[Route]   start:  ${startNodeName}  (${insideBuilding ? 'inside building' : 'nearest node'})`);
    console.log(`[Route]   path:   ${pathStr}${!targetInGraph ? `  →  mapbox final → ${targetBuilding}` : ''}`);

    // 5. Execute segments
    const executed: ExecutedSegment[] = [];

    // Initial Mapbox: user -> first building_node (skip if user is inside)
    if (!skipInitialMapbox) {
      const firstNode = routeSegments.length > 0 ? routeSegments[0].from : getNode(routeTarget)!;
      const dest = mapboxCoords(firstNode, userLocation);
      const snapDest = !firstNode.entranceNodes?.length;
      console.log(`[Route]   mapbox  user → entrance`);
      console.log(`[Route]     from  ${fmt(userLocation)}`);
      console.log(`[Route]     to    ${fmt(dest)}  ${snapDest ? '[snap]' : '[entrance - no snap]'}`);
      const seg = await buildMapboxSegment(
        userLocation,
        dest,
        { type: InstructionType.Enter, label: 'Enter the GopherWay' },
        { snapOrigin: false, snapDestination: snapDest },
      );
      if (seg) executed.push({ type: SegmentType.Mapbox, ...seg });
    }

    for (let i = 0; i < routeSegments.length; i++) {
      const segment = routeSegments[i];
      if (segment.type === GraphLayerType.Tunnel) {
        const prevWasTunnel = routeSegments[i - 1]?.type === GraphLayerType.Tunnel;
        const nextIsAlsoTunnel = routeSegments[i + 1]?.type === GraphLayerType.Tunnel;

        let steps = segment.steps!;
        if (prevWasTunnel || nextIsAlsoTunnel) {
          steps = steps.map((s, idx) => {
            if (idx === 0 && prevWasTunnel)
              return { ...s, instruction: { type: InstructionType.Forward, label: 'Continue through the GopherWay' } };
            if (idx === steps.length - 1 && nextIsAlsoTunnel)
              return { ...s, instruction: { type: InstructionType.Forward, label: 'Continue through the GopherWay' } };
            return s;
          });
        }

        executed.push({
          type: SegmentType.GT,
          steps,
          distance: segment.cost,
          duration: Math.round(segment.cost / ROUTING_CONFIG.WALKING_SPEED_MPS),
        });
      } else {
        const origin = mapboxCoords(segment.from, segment.to);
        const dest = mapboxCoords(segment.to, segment.from);
        const snapFrom = !segment.from.entranceNodes?.length;
        const snapTo = !segment.to.entranceNodes?.length;
        console.log(`[Route]   mapbox  outdoor  (${segment.from.buildingName} → ${segment.to.buildingName})`);
        console.log(`[Route]     from  ${fmt(origin)}  ${snapFrom ? '[snap]' : '[entrance - no snap]'}`);
        console.log(`[Route]     to    ${fmt(dest)}  ${snapTo ? '[snap]' : '[entrance - no snap]'}`);
        const seg = await buildMapboxSegment(
          origin,
          dest,
          { type: InstructionType.Forward, label: 'Continue walking' },
          { snapOrigin: snapFrom, snapDestination: snapTo },
        );
        if (seg) executed.push({ type: SegmentType.Mapbox, ...seg });
      }
    }

    // Final Mapbox leg for buildings not in the graph
    if (!targetInGraph) {
      const lastNode = routeSegments.length > 0
        ? routeSegments[routeSegments.length - 1].to
        : getNode(routeTarget)!;
      const origin = mapboxCoords(lastNode, targetCoords);
      const snapFrom = !lastNode.entranceNodes?.length;
      console.log(`[Route]   mapbox  final → ${targetBuilding}`);
      console.log(`[Route]     from  ${fmt(origin)}  ${snapFrom ? '[snap]' : '[entrance - no snap]'}`);
      console.log(`[Route]     to    ${fmt(targetCoords)}  [snap]`);
      const seg = await buildMapboxSegment(
        origin,
        targetCoords,
        { type: InstructionType.Final, label: `Walk to ${targetBuilding}` },
        { snapOrigin: snapFrom, snapDestination: true },
      );
      if (seg) executed.push({ type: SegmentType.Mapbox, ...seg });
    }

    const result = aggregateRoute(executed);

    // Only track visits if Neo4j is available (skip in offline mode)
    if (isWriteAvailable()) {
      await incrementBuildingVisit(session, targetBuilding);
    }

    res.json(result);
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[ERROR] Route failed: ${error.message}`);
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
              NOT b:TunnelBuilding AS is_disconnected
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
  } catch (err: unknown) {
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
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Search Error:', error);
    res.status(503).json({ error: 'Error while querying the database', details: error.message });
  }
}

/**
 * GET /graph
 * Returns graph statistics and connection state.
 */
export function getGraphStatus(_req: Request, res: Response) {
  const graphInfo = getGraphInfo();
  res.json({
    ...graphInfo,
    neo4jAvailable: isWriteAvailable(),
  });
}
