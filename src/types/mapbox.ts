/** A single step in a Mapbox route leg */
export interface MapboxStep {
  geometry?: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  maneuver?: {
    instruction: string;
    type: string;
    modifier?: string;
    bearing_before?: number;
    bearing_after?: number;
    location: [number, number];
  };
  duration?: number;
  distance?: number;
  name?: string;
  mode?: string;
}

/** A leg of a Mapbox route (from one waypoint to the next) */
export interface MapboxLeg {
  steps: MapboxStep[];
  duration: number;
  distance: number;
  summary?: string;
}

/** A complete Mapbox route */
export interface MapboxRoute {
  legs: MapboxLeg[];
  distance: number;
  duration: number;
  geometry?: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  weight?: number;
  weight_name?: string;
}

/** Waypoint snapped by Mapbox */
export interface MapboxWaypoint {
  name: string;
  location: [number, number];
  distance?: number;
}

/** Full Mapbox Directions API response */
export interface MapboxDirectionsResponse {
  code: string;
  routes: MapboxRoute[];
  waypoints?: MapboxWaypoint[];
  message?: string; // Error message when code !== 'Ok'
}

/** Mapbox Tilequery feature */
export interface TilequeryFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    class?: string;
    type?: string;
    structure?: 'none' | 'tunnel' | 'bridge';
    tilequery: {
      distance: number;
      geometry: string;
      layer: string;
    };
  };
}

/** Mapbox Tilequery API response */
export interface TilequeryResponse {
  type: 'FeatureCollection';
  features: TilequeryFeature[];
}
