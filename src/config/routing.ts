// User-selectable presets (for future API parameter)
export type RoutingPreference = 'indoor' | 'balanced' | 'fastest';

export const OUTDOOR_PENALTY_BY_PREFERENCE: Record<RoutingPreference, number> = {
  indoor: 2.0, // Strong tunnel preference
  balanced: 1.5, // Default - moderate tunnel preference
  fastest: 1.0, // Pure distance optimization
};

export const ROUTING_CONFIG = {
  DEFAULT_PREFERENCE: 'balanced' as RoutingPreference,
  MIN_DIRECT_WALK_METERS: 100, // Skip tunnel if direct walk < 100m
  INSIDE_BUILDING_METERS: 25, // User is considered inside a building if within this distance
  MAX_EXIT_RADIUS_KM: 0.5, // Only consider exits within 500m of target
  TUNNEL_ESTIMATE_FACTOR: 1.4, // Tunnel paths are ~1.4x straight-line distance

  // Start node selection constants
  FORWARD_DIRECTION_LEEWAY_FACTOR: 1.1, // Allow nodes slightly past destination
  MAX_START_NODES: 1, // Number of candidate start nodes to return
  DIRECTION_ANGLE_WEIGHT: 1, // Weight for angle-based scoring
  TARGET_BUILDING_PENALTY_MULTIPLIER: 1.15, // Prefer intermediate access points over destination
};
