import type { Coordinates, EntranceNode } from '../../types/nodes';
import { haversineDistance } from '../math';

/**
 * Returns the closest entrance node coordinate to a reference point.
 * Falls back to the provided fallback coords if no entrance nodes exist.
 */
export function closestEntranceCoords(
  entranceNodes: EntranceNode[] | undefined,
  reference: Coordinates,
  fallback: Coordinates,
): Coordinates {
  if (!entranceNodes || entranceNodes.length === 0) return fallback;

  let closest = entranceNodes[0];
  let minDist = haversineDistance(reference, { latitude: entranceNodes[0].lat, longitude: entranceNodes[0].lon });

  for (let i = 1; i < entranceNodes.length; i++) {
    const dist = haversineDistance(reference, { latitude: entranceNodes[i].lat, longitude: entranceNodes[i].lon });
    if (dist < minDist) {
      minDist = dist;
      closest = entranceNodes[i];
    }
  }

  return { latitude: closest.lat, longitude: closest.lon };
}