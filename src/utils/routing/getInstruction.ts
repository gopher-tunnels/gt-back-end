import bearing from '@turf/bearing';
import type { Node } from 'neo4j-driver';
import { RouteStep } from '../../types/nodes';

export const getInstruction = (
  current: Node,
  index: number,
  nodes: Node[],
): RouteStep['instruction'] => {
  if (!index) return { type: 'enter', label: 'Enter the GopherWay' };
  if (index === nodes.length - 1)
    return { type: 'final', label: "You've arrived!" };
  if (current.properties.node_type === 'elevator')
    return { type: 'elevator', label: 'Take the elevator' };
  const prevNode = nodes[index - 1];
  const nextNode = nodes[index + 1];
  const b0 = bearing(
    [prevNode.properties.longitude, prevNode.properties.latitude],
    [current.properties.longitude, current.properties.latitude],
  );
  const b1 = bearing(
    [current.properties.longitude, current.properties.latitude],
    [nextNode.properties.longitude, nextNode.properties.latitude],
  );
  const delta = b1 - b0;
  if (Math.abs(delta) < 20) return { type: 'forward', label: 'Head straight' };
  const turn = delta > 0 ? 'right' : 'left';
  return { type: turn, label: `Take a ${turn}` };
};
