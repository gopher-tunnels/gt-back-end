import axios from 'axios';
import { Coordinates } from '../types/nodes';
import { calculateBearing, angularDifference } from '../utils/math';

const mapboxClient = axios.create({
  baseURL: 'https://api.mapbox.com/directions/v5/mapbox',
});

// Configuration for sidewalk snapping
const SNAP_CONFIG = {
  SEARCH_RADIUS_METERS: 75, // Radius to search for nearby roads
  MAX_SNAP_DISTANCE_METERS: 100, // Don't snap if closest road is further than this
};

interface TilequeryFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    class?: string;
    type?: string;
    tilequery: {
      distance: number;
      geometry: string;
      layer: string;
    };
  };
}

interface TilequeryResponse {
  type: 'FeatureCollection';
  features: TilequeryFeature[];
}

/**
 * Query Mapbox Tilequery API to find nearby road features.
 * Uses mapbox-streets-v8 tileset to find sidewalks, paths, and roads.
 */
async function queryNearbyRoads(coords: Coordinates, radiusMeters: number): Promise<TilequeryFeature[]> {
  const accessToken = process.env.MAPBOX_API_KEY;
  if (!accessToken) {
    throw new Error('Missing MAPBOX_API_KEY environment variable');
  }

  try {
    const response = await axios.get<TilequeryResponse>(
      `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${coords.longitude},${coords.latitude}.json`,
      {
        params: {
          access_token: accessToken,
          radius: radiusMeters,
          limit: 50,
          layers: 'road',
          geometry: 'linestring',
        },
      },
    );

    return response.data.features;
  } catch (err) {
    console.error('[Tilequery] Failed to query nearby roads:', err);
    return [];
  }
}

/**
 * Snap coordinates to the nearest sidewalk/road in the direction of travel.
 *
 * This prevents Mapbox from using indoor routing when coordinates fall inside
 * the GopherWay tunnel system. The snap direction ensures users are routed
 * to the correct side of the building.
 *
 * @param coords - The coordinates to potentially snap
 * @param directionTarget - The other endpoint (used to determine which side to snap to)
 * @param isOrigin - True if snapping origin (snap toward destination), false if snapping destination (snap toward origin)
 */
export async function snapToNearestSidewalk(
  coords: Coordinates,
  directionTarget: Coordinates,
  isOrigin: boolean,
): Promise<Coordinates> {
  const roads = await queryNearbyRoads(coords, SNAP_CONFIG.SEARCH_RADIUS_METERS);

  if (roads.length === 0) {
    console.log(`[Snap] No nearby roads found, using original coordinates`);
    return coords;
  }

  // Calculate the desired bearing (direction we want to snap toward)
  // For origin: we want the side facing the destination
  // For destination: we want the side facing the origin
  const desiredBearing = isOrigin
    ? calculateBearing(coords, directionTarget)
    : calculateBearing(coords, directionTarget) + 180; // Reverse for destination
  const normalizedDesiredBearing = (desiredBearing + 360) % 360;

  // Score each road feature by:
  // 1. Distance (closer is better)
  // 2. Direction alignment (features in the desired direction are better)
  type ScoredFeature = TilequeryFeature & { score: number; bearing: number };

  const scoredFeatures: ScoredFeature[] = roads
    .filter((f) => f.properties.tilequery.distance <= SNAP_CONFIG.MAX_SNAP_DISTANCE_METERS)
    .map((feature) => {
      const featureCoords: Coordinates = {
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
      };

      // Bearing from original coords to this road feature
      const featureBearing = calculateBearing(coords, featureCoords);

      // Angular difference from desired direction (0-180, lower is better)
      const angleDiff = angularDifference(normalizedDesiredBearing, featureBearing);

      // Score: prioritize direction alignment, then distance
      // angleDiff ranges 0-180, distance ranges 0-MAX_SNAP_DISTANCE
      // Normalize both to 0-1 and weight direction more heavily
      const normalizedAngle = angleDiff / 180;
      const normalizedDistance = feature.properties.tilequery.distance / SNAP_CONFIG.MAX_SNAP_DISTANCE_METERS;

      // Lower score is better: 70% direction weight, 30% distance weight
      const score = normalizedAngle * 0.7 + normalizedDistance * 0.3;

      return { ...feature, score, bearing: featureBearing };
    });

  if (scoredFeatures.length === 0) {
    console.log(`[Snap] No suitable roads within ${SNAP_CONFIG.MAX_SNAP_DISTANCE_METERS}m, using original coordinates`);
    return coords;
  }

  // Sort by score (lowest first)
  scoredFeatures.sort((a, b) => a.score - b.score);
  const best = scoredFeatures[0];

  const snappedCoords: Coordinates = {
    longitude: best.geometry.coordinates[0],
    latitude: best.geometry.coordinates[1],
  };

  console.log(`[Snap] ${isOrigin ? 'Origin' : 'Destination'} snapped: (${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}) -> (${snappedCoords.latitude.toFixed(6)}, ${snappedCoords.longitude.toFixed(6)})`);
  console.log(`[Snap]   Distance: ${best.properties.tilequery.distance.toFixed(1)}m, Bearing: ${best.bearing.toFixed(0)}° (desired: ${normalizedDesiredBearing.toFixed(0)}°), Class: ${best.properties.class || 'unknown'}`);

  return snappedCoords;
}

export interface MapboxDirectionsOptions {
  snapToSidewalk?: boolean;
  radiusMeters?: number; // Search radius for matching coords to road network (default: 50)
}

export async function getMapboxWalkingDirections(
  origin: Coordinates,
  destination: Coordinates,
  options: MapboxDirectionsOptions = {},
) {
  const accessToken = process.env.MAPBOX_API_KEY;

  if (!accessToken) {
    throw new Error('Missing MAPBOX_API_KEY environment variable');
  }

  // Snap coordinates to nearest sidewalk if requested
  // This prevents Mapbox from using its indoor routing when coords are inside the GopherWay
  let snappedOrigin = origin;
  let snappedDestination = destination;

  if (options.snapToSidewalk) {
    console.log(`[Mapbox] Snapping coordinates to sidewalk...`);
    [snappedOrigin, snappedDestination] = await Promise.all([
      snapToNearestSidewalk(origin, destination, true),
      snapToNearestSidewalk(destination, origin, false),
    ]);
  }

  console.log(`[Mapbox] Request: (${snappedOrigin.latitude}, ${snappedOrigin.longitude}) -> (${snappedDestination.latitude}, ${snappedDestination.longitude})`);
  console.log(`[Mapbox] URL: walking/${snappedOrigin.longitude},${snappedOrigin.latitude};${snappedDestination.longitude},${snappedDestination.latitude}`);

  const radius = options.radiusMeters ?? 50;
  const response = await mapboxClient.get(
    `walking/${snappedOrigin.longitude},${snappedOrigin.latitude};${snappedDestination.longitude},${snappedDestination.latitude}`,
    {
      params: {
        access_token: accessToken,
        alternatives: false,
        radiuses: `${radius};${radius}`,
        geometries: 'geojson',
        overview: 'full',
        steps: true,
      },
    },
  );
  const data = response.data;
  if (data.waypoints) {
    console.log(`[Mapbox] Snapped waypoints:`, data.waypoints.map((w: any) => `(${w.location[1]}, ${w.location[0]})`).join(' -> '));
  }
  console.log(`[Mapbox] Route distance: ${data.routes?.[0]?.distance}m, duration: ${data.routes?.[0]?.duration}s`);
  return data;
}
