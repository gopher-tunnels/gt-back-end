// src/services/buildings.ts
import type { Session } from 'neo4j-driver';
import type { BuildingNode, Coordinates } from '../types/nodes';

/**
 * Checks whether a building name corresponds to a Disconnected_Building node.
 */
export async function isDisconnectedBuilding(
  session: Session,
  buildingName: string,
): Promise<boolean> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      MATCH (b:Building {building_name: $name})
      RETURN b:Disconnected_Building AS isDisconnected
      `,
      { name: buildingName },
    ),
  );

  if (!records.length) {
    return false;
  }

  return records[0].get('isDisconnected') === true;
}

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
 * Fetches latitude/longitude for any Building node by building_name.
 *
 * Works for both connected and disconnected buildings since Disconnected_Building
 * nodes also have the Building label.
 */
export async function getBuildingCoords(
  session: Session,
  buildingName: string,
): Promise<Coordinates | null> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      MATCH (b:Building {building_name: $name})
      RETURN b.latitude AS latitude,
             b.longitude AS longitude
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
