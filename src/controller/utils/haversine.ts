import { Coordinates } from "../../types/nodes"

export function haversineDistance(pointA: Coordinates, pointB: Coordinates): number {
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

    const EARTH_RADIUS_KM = 6371;

    const latitudeDifference = toRadians(pointB.latitude - pointA.latitude);
    const longitudeDifference = toRadians(pointB.longitude - pointA.longitude);

    const pointALatitudeRadians = toRadians(pointA.latitude);
    const pointBLatitudeRadians = toRadians(pointB.latitude);

    const a =
        Math.sin(latitudeDifference / 2) ** 2 +
        Math.cos(pointALatitudeRadians) * Math.cos(pointBLatitudeRadians) *
        Math.sin(longitudeDifference / 2) ** 2;

    const angularDistance = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_KM * angularDistance;
}
  