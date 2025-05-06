export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface BuildingNode extends Coordinates {
  buildingName: string;
  id: number;
}

export interface RouteStep extends BuildingNode {
  floor: string; // SB, 0B, 1, 2...
  nodeType: string; // elevator, building_node, or path
  type: string;
}
