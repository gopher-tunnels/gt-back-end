import type { Session } from 'neo4j-driver';
import { Coordinates, BuildingNode, NodeType } from '../types/nodes';
import { RouteStep, InstructionType, SegmentType, ExecutedSegment, RouteResult } from '../types/route';
import type { MapboxStep } from '../types/mapbox';
import { haversineDistance } from '../utils/math';
import { processMapboxInstruction } from '../utils/routing/processMapboxInstruction';
import { getMapboxWalkingDirections, MapboxDirectionsOptions } from './mapbox';
import { ROUTING_CONFIG } from '../config/routing';
import { incrementBuildingVisit } from './visits';
import { isWriteAvailable } from '../controller/db';

export interface MapboxSegmentResult {
  steps: RouteStep[];
  distance: number;
  duration: number;
}

export function aggregateRoute(segments: ExecutedSegment[]): RouteResult {
  return {
    steps: segments.map((s) => ({ type: s.type, steps: s.steps })),
    totalDistance: segments.reduce((sum, s) => sum + s.distance, 0),
    totalTime: segments.reduce((sum, s) => sum + s.duration, 0),
  };
}

/**
 * Builds a Mapbox walking segment between two coordinates.
 */
export async function buildMapboxSegment(
  origin: Coordinates,
  destination: Coordinates,
  finalInstruction: { type: InstructionType; label: string },
  options: MapboxDirectionsOptions = {},
): Promise<MapboxSegmentResult | null> {
  try {
    let mapboxDirections = await getMapboxWalkingDirections(origin, destination, options);

    if (!mapboxDirections.routes?.length && (options.snapOrigin || options.snapDestination)) {
      console.warn('[Route]     snap failed — retrying without sidewalk snap');
      mapboxDirections = await getMapboxWalkingDirections(origin, destination, { radiusMeters: 100 });
    }

    if (!mapboxDirections.routes?.length || !mapboxDirections.routes[0]?.legs?.length) {
      console.error('[Mapbox] No routes returned - code:', mapboxDirections.code);
      return null;
    }

    const leg = mapboxDirections.routes[0].legs[0];
    const rawSteps: { coords: [number, number]; instruction?: string }[] = [];

    const firstCoord = leg.steps[0]?.geometry?.coordinates?.[0];
    if (firstCoord) rawSteps.push({ coords: firstCoord, instruction: undefined });

    leg.steps.slice(0, -1).forEach((step: MapboxStep) => {
      const coords: [number, number][] = step?.geometry?.coordinates || [];
      const startIdx = 1;
      coords.slice(startIdx).forEach((coord: [number, number], coordIndex: number) => {
        rawSteps.push({
          coords: coord,
          instruction: coordIndex === 0 ? step?.maneuver?.instruction : undefined,
        });
      });
    });

    if (rawSteps.length === 0) return null;

    console.log(`[Route]     mapbox returned ${rawSteps.length} coords:`);
    rawSteps.forEach(({ coords }) => console.log(`[Route]       ${coords[0]}, ${coords[1]}`));

    const steps: RouteStep[] = rawSteps.map(({ coords }, index) => ({
      buildingName: '',
      latitude: coords[1],
      longitude: coords[0],
      id: JSON.stringify(coords),
      instruction:
        index !== rawSteps.length - 1
          ? processMapboxInstruction(rawSteps[index + 1]?.instruction || '')
          : finalInstruction,
      floor: '0',
      nodeType: NodeType.Sidewalk,
      type: SegmentType.Mapbox,
    }));

    return {
      steps,
      distance: mapboxDirections.routes[0].distance,
      duration: mapboxDirections.routes[0].duration,
    };
  } catch (err) {
    console.error('Mapbox Directions API failed:', err);
    return null;
  }
}

/**
 * Handles early exit when user is close enough for a direct walk (< MIN_DIRECT_WALK_METERS).
 */
export async function handleDirectWalk(
  session: Session,
  userLocation: Coordinates,
  targetCoords: Coordinates,
  targetBuilding: string,
): Promise<RouteResult | null> {
  const distMeters = haversineDistance(userLocation, targetCoords) * 1000;
  if (distMeters >= ROUTING_CONFIG.MIN_DIRECT_WALK_METERS) return null;

  const segment = await buildMapboxSegment(
    userLocation,
    targetCoords,
    { type: InstructionType.Final, label: `Arrive at ${targetBuilding}` },
    { snapOrigin: false, snapDestination: true },
  );
  if (!segment) return null;

  if (isWriteAvailable()) {
    await incrementBuildingVisit(session, targetBuilding);
  }
  return {
    steps: [{ type: SegmentType.Mapbox, steps: segment.steps }],
    totalDistance: segment.distance,
    totalTime: segment.duration,
  };
}

/**
 * Finds if user is inside a building (within INSIDE_BUILDING_METERS of a building_node).
 */
export function findUserInsideBuilding(
  buildingNodes: BuildingNode[],
  userLocation: Coordinates,
): BuildingNode | null {
  const thresholdKm = ROUTING_CONFIG.INSIDE_BUILDING_METERS / 1000;
  for (const node of buildingNodes) {
    if (haversineDistance(userLocation, node) <= thresholdKm) return node;
  }
  return null;
}
