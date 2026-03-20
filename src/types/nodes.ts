export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Node types in the routing graph */
export enum NodeType {
  BuildingNode = 'building_node',
  Path = 'path',
  Elevator = 'elevator',
  Sidewalk = 'sidewalk',
}

export interface BuildingNode extends Coordinates {
  buildingName: string;
  id: number | string;
  /** Outdoor entrance points for Mapbox routing. Closest one to the reference point is used. Falls back to latitude/longitude if absent. */
  entranceNodes?: Coordinates[];
}
