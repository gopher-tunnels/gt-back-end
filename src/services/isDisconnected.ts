// src/services/isDisconnectedBuilding.ts
import type { Session } from 'neo4j-driver';

/**
 * Checks whether a building name corresponds to a Disconnected_Building node.
 *
 * @param session - An open Neo4j session.
 * @param buildingName - The building_name to check.
 * @returns Promise<boolean> - true if it is a Disconnected_Building, false otherwise.
 */
export async function isDisconnectedBuilding(
  session: Session,
  buildingName: string,
): Promise<boolean> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      OPTIONAL MATCH (b:Disconnected_Building {building_name: $name})
      RETURN b IS NOT NULL AS isDisconnected
      `,
      { name: buildingName },
    ),
  );

  if (!records.length) {
    return false;
  }

  return Boolean(records[0].get('isDisconnected'));
}
