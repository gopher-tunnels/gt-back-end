import { BuildingNode, Coordinates } from '../../types/nodes';
import { haversineDistance } from '../../utils/haversine';
import { toRadians } from '../../utils/math';
import { ROUTING_CONFIG } from '../../config/routing';

type Vector2D = { x: number; y: number };

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
  targetBuildingName: string,
): BuildingNode[] {
  const destinationNode = buildings.find(
    (b) => b.buildingName === targetBuildingName,
  );

  if (!destinationNode) {
    throw new Error(
      `Target building "${targetBuildingName}" not found in node list.`,
    );
  }

  const userDistToDest = haversineDistance(userLocation, destinationNode);
  const vectorToDest = toVector(userLocation, destinationNode);

  const candidates = buildings.filter((building) => {
    const distToDest = haversineDistance(building, destinationNode);
    return distToDest <= userDistToDest * ROUTING_CONFIG.FORWARD_DIRECTION_LEEWAY_FACTOR;
  });

  const scoredCandidates = candidates
    .map((building) => {
      const distanceFromUser = haversineDistance(userLocation, building);
      const vectorToBuilding = toVector(userLocation, building);
      const angleToDestination = getAngleBetween(
        vectorToDest,
        vectorToBuilding,
      );
      const angleRatio = Number.isFinite(angleToDestination)
        ? angleToDestination / Math.PI
        : 0;

      // favor nodes that minimize outdoor distance while keeping the approach aligned with the destination
      const baseCost =
        distanceFromUser * (1 + ROUTING_CONFIG.DIRECTION_ANGLE_WEIGHT * angleRatio);
      const isTarget = building.buildingName === targetBuildingName;
      const adjustedCost =
        isTarget && candidates.length > 1
          ? baseCost * ROUTING_CONFIG.TARGET_BUILDING_PENALTY_MULTIPLIER
          : baseCost;

      return {
        building,
        adjustedCost,
        angleRatio,
        distanceFromUser,
        isTarget,
      };
    })
    .sort((a, b) => {
      if (a.adjustedCost !== b.adjustedCost) {
        return a.adjustedCost - b.adjustedCost;
      }
      if (a.angleRatio !== b.angleRatio) {
        return a.angleRatio - b.angleRatio;
      }
      if (a.isTarget !== b.isTarget) {
        return a.isTarget ? 1 : -1;
      }
      if (a.distanceFromUser !== b.distanceFromUser) {
        return a.distanceFromUser - b.distanceFromUser;
      }
      return a.building.buildingName.localeCompare(b.building.buildingName);
    });

  return scoredCandidates.slice(0, ROUTING_CONFIG.MAX_START_NODES).map((entry) => entry.building);
}

function toVector(from: Coordinates, to: Coordinates): Vector2D {
  const lat1 = toRadians(from.latitude);
  const lon1 = toRadians(from.longitude);
  const lat2 = toRadians(to.latitude);
  const lon2 = toRadians(to.longitude);

  return {
    x: (lon2 - lon1) * Math.cos((lat1 + lat2) / 2),
    y: lat2 - lat1,
  };
}

function getAngleBetween(a: Vector2D, b: Vector2D): number {
  const magnitudeA = getMagnitude(a);
  const magnitudeB = getMagnitude(b);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  const dot = a.x * b.x + a.y * b.y;
  const cosine = clamp(dot / (magnitudeA * magnitudeB), -1, 1);
  return Math.acos(cosine);
}

function getMagnitude(vector: Vector2D): number {
  return Math.hypot(vector.x, vector.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
