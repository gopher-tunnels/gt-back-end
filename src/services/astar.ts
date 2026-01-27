import type { Session, Node, Path } from 'neo4j-driver';
import type { RouteStep } from '../types/nodes';
import { getInstruction } from '../utils/routing/getInstruction';

export interface AStarResult {
  steps: RouteStep[];
  weight: number;
}

/**
 * Runs A* between two building_node nodes and returns GT RouteSteps + weight.
 */
export async function astar(
  session: Session,
  startName: string,
  endName: string,
): Promise<AStarResult | null> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      MATCH (start:Node {building_name: $startName, node_type: 'building_node'})
      WITH start
      MATCH (end:Node {building_name: $endName, node_type: 'building_node'})
      CALL apoc.algo.aStar(
        start,
        end,
        'CONNECTED_TO',
        'distance',
        'latitude',
        'longitude'
      ) YIELD path, weight
      RETURN path, weight
      `,
      { startName, endName },
    ),
  );

  if (!records.length) return null;

  const path = records[0].get('path') as Path;
  const weight = records[0].get('weight') as number;

  const nodes: Node[] = [path.start, ...path.segments.map((s: any) => s.end)];

  const steps: RouteStep[] = nodes.map((node: Node, index): RouteStep => ({
    buildingName: node.properties.building_name,
    latitude: node.properties.latitude,
    longitude: node.properties.longitude,
    id: node.identity.toNumber(),
    floor: node.properties.floor,
    nodeType: node.properties.node_type,
    type: 'GT',
    instruction: getInstruction(node, index, nodes),
  }));

  return { steps, weight };
}
