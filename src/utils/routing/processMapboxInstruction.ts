import { RouteStep, InstructionType } from '../../types/route';

export const processMapboxInstruction = (
  instruction: string,
): RouteStep['instruction'] => {
  const label = instruction.slice(0, -1);
  const lower = instruction.toLowerCase();
  if (lower.includes('enter')) return { type: InstructionType.Enter, label };
  if (
    lower.includes('walk') ||
    lower.includes('straight') ||
    lower.includes('forward')
  )
    return { type: InstructionType.Forward, label };
  if (lower.includes('arrived') || lower.includes('on your'))
    return { type: InstructionType.Final, label };
  if (lower.includes('right')) return { type: InstructionType.Right, label };
  if (lower.includes('left')) return { type: InstructionType.Left, label };
  return { type: InstructionType.Forward, label };
};
