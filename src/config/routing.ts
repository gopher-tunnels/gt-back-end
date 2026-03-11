export type RoutingPreference = 'indoor' | 'balanced' | 'fastest';

export const OUTDOOR_PENALTY_BY_PREFERENCE: Record<RoutingPreference, number> = {
  indoor: 3.0,    // Strong tunnel preference
  balanced: 1.5,  // Moderate tunnel preference
  fastest: 1.0,   // Pure distance optimization
};

export const ROUTING_CONFIG = {
  DEFAULT_PREFERENCE: 'indoor' as RoutingPreference,
  MIN_DIRECT_WALK_METERS: 100,   // Skip tunnel if direct walk < 100m
  INSIDE_BUILDING_METERS: 25,    // User considered inside a building within this distance
  WALKING_SPEED_MPS: 1.4,        // m/s used to estimate tunnel traversal time
  MIN_MAPBOX_SEGMENT_METERS: 60, // Skip Mapbox API for outdoor segments shorter than this

  // Start node selection constants
  FORWARD_DIRECTION_LEEWAY_FACTOR: 1.06,
  MAX_START_NODES: 1,
  DIRECTION_ANGLE_WEIGHT: 1,
  TARGET_BUILDING_PENALTY_MULTIPLIER: 1.15,
};
