
export  type Query = {
    startLat: number,
    startLong: number,
    target: string,
  }
export  type Node = {
    name: string;
    id: number;
    latitude: number;
    longitude: number;
  };
  
export  type Step = {
    node: Node;
    nextDirection?: number; // relative to true north
    distance:number;
    time:number
  };
  
export type ReturnType = Step[];