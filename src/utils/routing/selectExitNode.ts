import type { BuildingNode, Coordinates } from '../../types/nodes';
import { haversineDistance } from '../haversine';
import {
  ROUTING_CONFIG,
  OUTDOOR_PENALTY_BY_PREFERENCE,
  type RoutingPreference,
} from '../../config/routing';

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
