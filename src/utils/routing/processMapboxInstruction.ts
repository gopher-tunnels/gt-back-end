import { RouteStep } from '../../types/nodes';

export const processMapboxInstruction = (
  instruction: string,
): RouteStep['instruction'] => {
  const label = instruction.slice(0, -1);
  const lower = instruction.toLowerCase();
  if (lower.includes('enter')) return { type: 'enter', label };
  if (
    lower.includes('walk') ||
    lower.includes('straight') ||
    lower.includes('forward')
  )
    return { type: 'forward', label };
  if (lower.includes('arrived') || lower.includes('on your'))
    return { type: 'final', label };
  if (lower.includes('right')) return { type: 'right', label };
  if (lower.includes('left')) return { type: 'left', label };
  return { type: 'forward', label };
};
