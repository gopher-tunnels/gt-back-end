// src/services/buildings.ts
import type { Session } from 'neo4j-driver';
import type { BuildingNode, Coordinates } from '../types/nodes';
import { haversineDistance } from '../utils/haversine';
import {
  ROUTING_CONFIG,
  OUTDOOR_PENALTY_BY_PREFERENCE,
  type RoutingPreference,
} from '../config/routing';

/**
 * Fetches building_node candidates that are connected to a given target building.
 *
 * This is used by getRoute() to find reasonable GT start nodes for a specific
 * target building.
 *
 * Returns:
 *  - the building_node(s) for the target building itself
 *  - plus other building_node nodes reachable within 1..400 hops
 */
export async function fetchConnectedBuildingNodes(
  session: Session,
  targetBuilding: string,
): Promise<BuildingNode[]> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      MATCH (start:Node {building_name: $targetBuilding, node_type: "building_node"})
      RETURN id(start) AS id,
             start.building_name AS name,
             start.longitude AS longitude,
             start.latitude AS latitude

      UNION

      MATCH (start:Node {building_name: $targetBuilding, node_type: "building_node"})
      MATCH path = (start)-[*1..400]-(connected:Node)
      WHERE connected.node_type = "building_node" AND connected <> start
      RETURN DISTINCT id(connected) AS id,
             connected.building_name AS name,
             connected.longitude AS longitude,
             connected.latitude AS latitude
      `,
      { targetBuilding },
    ),
  );

  return records.map((record) => ({
    buildingName: record.get('name'),
    longitude: record.get('longitude'),
    latitude: record.get('latitude'),
    id: record.get('id').toNumber(),
  }));
}

/**
 * Fetches latitude/longitude for a Disconnected_Building node by building_name.
 *
 * Used when the user selects a disconnected building as the target so we can:
 *  - create a final Mapbox segment from the GT exit to this disconnected node
 */
export async function getDisconnectedBuildingCoords(
  session: Session,
  buildingName: string,
): Promise<Coordinates | null> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      MATCH (d:Disconnected_Building {building_name: $name})
      RETURN d.latitude AS latitude,
             d.longitude AS longitude
      `,
      { name: buildingName },
    ),
  );

  if (!records.length) return null;

  const rec = records[0];
  const latitude = rec.get('latitude');
  const longitude = rec.get('longitude');

  if (latitude == null || longitude == null) {
    return null;
  }

  return { latitude, longitude };
}

/**
 * Fetches all Node nodes with node_type = "building_node".
 * 
 * WE ALREADY HAVE AN ENDPOINT FOR THIS. TODO: MERGE FOR DRY
 *
 * Used for the disconnected-building edge case so we can:
 *  - choose a GT end building that is in front of the user and
 *    close to the disconnected building.
 */
export async function fetchAllBuildingNodes(
  session: Session,
): Promise<BuildingNode[]> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      MATCH (n:Node { node_type: "building_node" })
      RETURN id(n) AS id,
             n.building_name AS building_name,
             n.latitude AS latitude,
             n.longitude AS longitude
      `,
    ),
  );

  return records.map((record) => ({
    id: record.get('id').toNumber(),
    buildingName: record.get('building_name'),
    latitude: record.get('latitude'),
    longitude: record.get('longitude'),
  }));
}

/**
 * Selects the optimal tunnel exit node for routing to a disconnected building.
 *
 * Uses a weighted cost function to balance tunnel distance vs outdoor walking:
 *   cost = tunnel_estimate + (outdoor_distance × outdoor_penalty)
 *
 * @param allBuildingNodes - All available building_node entries
 * @param disconnectedCoords - Coordinates of the disconnected building target
 * @param userLocation - User's current location
 * @param preference - Routing preference (indoor/balanced/fastest)
 * @returns The optimal exit node, or null if no candidates found
 */
export function selectOptimalExitNode(
  allBuildingNodes: BuildingNode[],
  disconnectedCoords: Coordinates,
  userLocation: Coordinates,
  preference: RoutingPreference = ROUTING_CONFIG.DEFAULT_PREFERENCE,
): BuildingNode | null {
  const outdoorPenalty = OUTDOOR_PENALTY_BY_PREFERENCE[preference];

  // Filter to exit candidates within reasonable radius of disconnected building
  const exitCandidates = allBuildingNodes.filter(
    (node) =>
      haversineDistance(node, disconnectedCoords) < ROUTING_CONFIG.MAX_EXIT_RADIUS_KM,
  );

  // Fallback: if no candidates within radius, use closest building_node
  if (exitCandidates.length === 0) {
    if (allBuildingNodes.length === 0) return null;

    let closest = allBuildingNodes[0];
    let closestDist = haversineDistance(closest, disconnectedCoords);

    for (let i = 1; i < allBuildingNodes.length; i++) {
      const dist = haversineDistance(allBuildingNodes[i], disconnectedCoords);
      if (dist < closestDist) {
        closest = allBuildingNodes[i];
        closestDist = dist;
      }
    }

    return closest;
  }

  // Score each candidate using weighted cost function
  const scored = exitCandidates.map((node) => {
    const outdoorDist = haversineDistance(node, disconnectedCoords);
    // Estimate tunnel distance: straight-line × factor (tunnels aren't direct)
    const tunnelEstimate =
      haversineDistance(userLocation, node) * ROUTING_CONFIG.TUNNEL_ESTIMATE_FACTOR;
    const weightedCost = tunnelEstimate + outdoorDist * outdoorPenalty;

    return { node, weightedCost };
  });

  // Sort by weighted cost and return best option
  scored.sort((a, b) => a.weightedCost - b.weightedCost);

  return scored[0].node;
}
