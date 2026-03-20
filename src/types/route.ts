import type { BuildingNode } from './nodes';

/** Instruction types for navigation steps */
export enum InstructionType {
  Enter = 'enter',
  Forward = 'forward',
  Elevator = 'elevator',
  Left = 'left',
  Right = 'right',
  Final = 'final',
}

/** Segment types in route responses */
export enum SegmentType {
  /** GopherTunnels indoor segment */
  GT = 'GT',
  /** Mapbox outdoor walking segment */
  Mapbox = 'mapbox',
}

/** Layer type used by the multilayer graph */
export enum GraphLayerType {
  Tunnel = 'tunnel',
  Outdoor = 'outdoor',
}

export interface RouteStep extends BuildingNode {
  instruction?: {
    type: InstructionType;
    label?: string;
  };
  floor: string; // SB, 0B, 1, 2...
  nodeType: string; // Allow string for backwards compatibility with DB values
  type: SegmentType | string; // Allow string for backwards compatibility
}

export interface RouteSegment {
  type: GraphLayerType;
  from: BuildingNode;
  to: BuildingNode;
  steps?: RouteStep[];
  cost: number;
}

export interface ExecutedSegment {
  type: string;
  steps: RouteStep[];
  distance: number;
  duration: number;
}

export interface RouteResult {
  steps: { type: string; steps: RouteStep[] }[];
  totalDistance: number;
  totalTime: number;
}
