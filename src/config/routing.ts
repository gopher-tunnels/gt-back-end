/** User preference for route optimization */
export enum RoutingPreference {
  /** Strongly prefer tunnel routes (3× outdoor penalty) */
  Indoor = 'indoor',
  /** Moderate tunnel preference */
  Balanced = 'balanced',
  /** Pure distance optimization (no penalty) */
  Fastest = 'fastest',
}

export const OUTDOOR_PENALTY_BY_PREFERENCE: Record<RoutingPreference, number> = {
  [RoutingPreference.Indoor]: 3.0,
  [RoutingPreference.Balanced]: 2.0,
  [RoutingPreference.Fastest]: 1.0,
};

export const ROUTING_CONFIG = {
  DEFAULT_PREFERENCE: RoutingPreference.Balanced,
  MIN_DIRECT_WALK_METERS: 100,   // Skip tunnel if direct walk < 100m
  INSIDE_BUILDING_METERS: 25,    // User considered inside a building within this distance
  WALKING_SPEED_MPS: 1.4,        // m/s used to estimate tunnel traversal time
  MIN_MAPBOX_SEGMENT_METERS: 60, // Skip Mapbox API for outdoor segments shorter than this
};
