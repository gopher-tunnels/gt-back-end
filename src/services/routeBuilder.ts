// src/services/routeBuilder.ts
import type { Session } from 'neo4j-driver';
import { Coordinates, BuildingNode, RouteStep } from '../types/nodes';
import { haversineDistance } from '../utils/math';
import { processMapboxInstruction } from '../utils/routing/processMapboxInstruction';
import { selectOptimalExitNode } from '../utils/routing/selectExitNode';
import { getMapboxWalkingDirections } from './mapbox';
import {
  fetchConnectedBuildingNodes,
  fetchAllBuildingNodes,
} from './buildings';
import { incrementBuildingVisit } from './visits';
import { ROUTING_CONFIG } from '../config/routing';

// the units of the distance is meters
// the units of the time is seconds
export interface RouteResult {
  steps: { type: string; steps: RouteStep[] }[]; // In order of the path.
  totalDistance: number;
  totalTime: number;
}

export interface MapboxSegmentResult {
  steps: RouteStep[];
  distance: number;
  duration: number;
}

/**
 * Aggregates route segments into a final RouteResult.
 */
export function aggregateRoute(
  mapboxSegment1: MapboxSegmentResult,
  gtSteps: RouteStep[],
  gtWeight: number,
  mapboxSegment2: MapboxSegmentResult | null,
): RouteResult {
  const steps: { type: string; steps: RouteStep[] }[] = [
    { type: 'mapbox', steps: mapboxSegment1.steps },
    { type: 'GT', steps: gtSteps },
  ];

  if (mapboxSegment2 && mapboxSegment2.steps.length > 0) {
    steps.push({ type: 'mapbox', steps: mapboxSegment2.steps });
  }

  const totalDistance =
    gtWeight +
    mapboxSegment1.distance +
    (mapboxSegment2?.distance ?? 0);

  const totalTime =
    Math.round(gtWeight / ROUTING_CONFIG.TUNNEL_ESTIMATE_FACTOR) +
    mapboxSegment1.duration +
    (mapboxSegment2?.duration ?? 0);

  return { steps, totalDistance, totalTime };
}

/**
 * Builds a Mapbox walking segment between two coordinates.
 * Consolidates duplicated Mapbox transformation logic.
 */
export async function buildMapboxSegment(
  origin: Coordinates,
  destination: Coordinates,
  finalInstruction: { type: 'enter' | 'forward' | 'elevator' | 'left' | 'right' | 'final'; label: string },
): Promise<MapboxSegmentResult | null> {
  try {
    const mapboxDirections = await getMapboxWalkingDirections(origin, destination);
    const leg = mapboxDirections.routes[0].legs[0];

    const rawSteps: { coords: [number, number]; instruction?: string }[] = [
      { coords: leg.steps[0]?.geometry?.coordinates?.[0] || [0, 0] },
      ...leg.steps.slice(0, -1).map((step: any) => ({
        coords: step?.geometry?.coordinates?.[1] || [0, 0],
        instruction: step?.maneuver?.instruction,
      })),
      { coords: [destination.longitude, destination.latitude] }, //THIS ADDS THE ACTUAL DEST COORDS AS THE FINAL POINT
    ];

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
      nodeType: 'sidewalk',
      type: 'mapbox',
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
 * Resolves routing parameters for normal (connected) buildings.
 */
export async function resolveConnectedTarget(
  session: Session,
  targetBuilding: string,
): Promise<{ routingTargetBuilding: string; buildingNodesForRouting: BuildingNode[] } | null> {
  const buildingNodesForRouting = await fetchConnectedBuildingNodes(session, targetBuilding);

  if (!buildingNodesForRouting.length) {
    console.error('No connected building nodes found for target', targetBuilding);
    return null;
  }

  return { routingTargetBuilding: targetBuilding, buildingNodesForRouting };
}

/**
 * Resolves routing parameters for disconnected buildings using optimal exit selection.
 */
export async function resolveDisconnectedTarget(
  session: Session,
  targetBuilding: string,
  userLocation: Coordinates,
  disconnectedCoords: Coordinates | null,
): Promise<{
  disconnectedCoords: Coordinates;
  routingTargetBuilding: string;
  buildingNodesForRouting: BuildingNode[];
} | null> {
  if (!disconnectedCoords) {
    console.error('Disconnected building has no latitude/longitude:', targetBuilding);
    return null;
  }

  const allBuildingNodes = await fetchAllBuildingNodes(session);
  if (!allBuildingNodes.length) {
    console.error('No building nodes available for routing');
    return null;
  }

  const optimalExit = selectOptimalExitNode(allBuildingNodes, disconnectedCoords, userLocation);
  if (!optimalExit) {
    console.error('Could not find optimal exit node');
    return null;
  }

  return {
    disconnectedCoords,
    routingTargetBuilding: optimalExit.buildingName,
    buildingNodesForRouting: allBuildingNodes,
  };
}

/**
 * Handles early exit when user is close to any building (connected or disconnected).
 * Returns a direct Mapbox-only route if within MIN_DIRECT_WALK_METERS, or null to continue with tunnel routing.
 */
export async function handleDirectWalk(
  session: Session,
  userLocation: Coordinates,
  targetCoords: Coordinates,
  targetBuilding: string,
): Promise<RouteResult | null> {
  const directWalkDistKm = haversineDistance(userLocation, targetCoords);
  const directWalkDistMeters = directWalkDistKm * 1000;

  if (directWalkDistMeters >= ROUTING_CONFIG.MIN_DIRECT_WALK_METERS) {
    return null; // Continue with tunnel routing
  }

  const segment = await buildMapboxSegment(
    userLocation,
    targetCoords,
    { type: 'final', label: `Arrive at ${targetBuilding}` },
  );

  if (!segment) {
    return null; // Mapbox failed, fall back to tunnel routing
  }

  await incrementBuildingVisit(session, targetBuilding);

  return {
    steps: [{ type: 'mapbox', steps: segment.steps }],
    totalDistance: segment.distance,
    totalTime: segment.duration,
  };
}

/**
 * Finds if user is inside a building (within INSIDE_BUILDING_METERS of a building_node).
 * Returns the building node the user is in, or null if not inside any building.
 */
export function findUserInsideBuilding(
  buildingNodes: BuildingNode[],
  userLocation: Coordinates,
): BuildingNode | null {
  const thresholdKm = ROUTING_CONFIG.INSIDE_BUILDING_METERS / 1000;

  for (const node of buildingNodes) {
    const distKm = haversineDistance(userLocation, {
      latitude: node.latitude,
      longitude: node.longitude,
    });
    if (distKm <= thresholdKm) {
      return node;
    }
  }

  return null;
}

