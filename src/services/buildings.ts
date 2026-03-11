import type { Session } from 'neo4j-driver';
import type { Coordinates } from '../types/nodes';

/**
 * Fetches latitude/longitude for any Building node by building_name.
 * Works for both connected and disconnected buildings.
 */
export async function getBuildingCoords(
  session: Session,
  buildingName: string,
): Promise<Coordinates | null> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      MATCH (b:Building {building_name: $name})
      RETURN b.latitude AS latitude, b.longitude AS longitude
      `,
      { name: buildingName },
    ),
  );

  if (!records.length) return null;

  const latitude = records[0].get('latitude');
  const longitude = records[0].get('longitude');
  if (latitude == null || longitude == null) return null;

  return { latitude, longitude };
}
