import bearing from '@turf/bearing';
import type { Node } from 'neo4j-driver';
import { RouteStep, InstructionType } from '../../types/route';

export const getInstruction = (
  current: Node,
  index: number,
  nodes: Node[],
): RouteStep['instruction'] => {
  if (!index) return { type: InstructionType.Enter, label: 'Enter the GopherWay' };
  if (index === nodes.length - 1)
    return { type: InstructionType.Final, label: "You've arrived!" };
  if (current.properties.node_type === 'elevator')
    return { type: InstructionType.Elevator, label: 'Take the elevator' };
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
  const delta = ((b1 - b0 + 540) % 360) - 180;
  if (Math.abs(delta) < 20) return { type: InstructionType.Forward, label: 'Head straight' };
  const turn = delta > 0 ? InstructionType.Right : InstructionType.Left;
  return { type: turn, label: `Take a ${delta > 0 ? 'right' : 'left'}` };
};
