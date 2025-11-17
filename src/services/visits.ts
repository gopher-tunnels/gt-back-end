import type { Session } from 'neo4j-driver';

/**
 * Increment visits for a building, throttled to once per 60 seconds.
 */
export async function incrementBuildingVisit(
  session: Session,
  buildingName: string,
): Promise<void> {
  await session.executeWrite((tx) =>
    tx.run(
      `
      MATCH (b:Building {building_name: $name})
      WHERE datetime().epochSeconds - coalesce(b.lastUpdated.epochSeconds, 0) >= 120
      SET b.visits = b.visits + 1,
          b.lastUpdated = datetime()
      `,
      { name: buildingName },
    ),
  );
}
