export type Vertex = {
  identity: {
    low: number;
    high: number;
  };
  labels: string[];
  properties: {
    building_name: string;
    visits: number;
    node_type: string;
    latitude: number;
    id: {
      low: number;
      high: number;
    };
    floor: string;
    longitude: number;
  };
  elementId: string;
};
