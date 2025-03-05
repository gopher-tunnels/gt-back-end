export type Vertex = {
    name: string,
    id: number,
    kind: "start" | "tunnel" | "target",
    latitude: number,
    longitude: number,
  }
  
export  type Path = {
    from: number,
    to: number,
    attributes: string[]
  }
export  type Query = {
    startLat: number,
    startLong: number,
    target: string,
  }