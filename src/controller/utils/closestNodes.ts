import { BuildingNode, Coordinates } from "../../types/nodes";
import { haversineDistance } from "./haversine";

const FORWARD_DIRECTION_LEEWAY_FACTOR = 1.06;
const MAX_NODES = 1;

/**
 * Retrieves closets nodes to user location for getRoute endpoint.
 *
 * @returns An array of the closest building nodes in order from closest to furthest
 * TODO: Add a 4th node that is at least behind the user just in case.
 * - Use vector normalization for better foward measuring
 * - Remove nodes from closest array that are part of immediate path for closer ones.
 */
export function getCandidateStartNodes(
  buildings: BuildingNode[],
  userLocation: Coordinates,
  targetBuildingName: string
): BuildingNode[] {
  const destinationNode = buildings.find(
    (b) => b.buildingName === targetBuildingName
  );

  if (!destinationNode) {
    throw new Error(
      `Target building "${targetBuildingName}" not found in node list.`
    );
  }

  const userDistToDest = haversineDistance(userLocation, destinationNode);

  const candidates = buildings.filter((building) => {
    const distToDest = haversineDistance(building, destinationNode);
    return distToDest <= userDistToDest * FORWARD_DIRECTION_LEEWAY_FACTOR;
  });

  const sortedByProximity = candidates.sort((a, b) => {
    const distA = haversineDistance(userLocation, a);
    const distB = haversineDistance(userLocation, b);
    return distA - distB;
  });

  return sortedByProximity.slice(0, MAX_NODES);
}
