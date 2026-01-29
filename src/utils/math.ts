import { Coordinates } from '../types/nodes';

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

const EARTH_RADIUS_KM = 6371;

export function haversineDistance(pointA: Coordinates, pointB: Coordinates): number {
  const latitudeDifference = toRadians(pointB.latitude - pointA.latitude);
  const longitudeDifference = toRadians(pointB.longitude - pointA.longitude);

  const pointALatitudeRadians = toRadians(pointA.latitude);
  const pointBLatitudeRadians = toRadians(pointB.latitude);

  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(pointALatitudeRadians) *
      Math.cos(pointBLatitudeRadians) *
      Math.sin(longitudeDifference / 2) ** 2;

  const angularDistance = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * angularDistance;
}

/**
 * Calculate bearing from point A to point B in degrees (0-360, where 0 is north).
 */
export function calculateBearing(from: Coordinates, to: Coordinates): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const x = Math.sin(dLon) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const bearing = (Math.atan2(x, y) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Calculate the angular difference between two bearings (0-180 degrees).
 */
export function angularDifference(bearing1: number, bearing2: number): number {
  let diff = Math.abs(bearing1 - bearing2);
  if (diff > 180) diff = 360 - diff;
  return diff;
}
