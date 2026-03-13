export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface BuildingNode extends Coordinates {
  buildingName: string;
  id: number | string;
  /** Outdoor entrance points for Mapbox routing. Closest one to the reference point is used. Falls back to latitude/longitude if absent. */
  entranceNodes?: Coordinates[];
}

export interface RouteStep extends BuildingNode {
  instruction?: {
    type: 'enter' | 'forward' | 'elevator' | 'left' | 'right' | 'final';
    label?: string;
  };
  floor: string; // SB, 0B, 1, 2...
  nodeType: string; // elevator, building_node, or path
  type: string;
}
