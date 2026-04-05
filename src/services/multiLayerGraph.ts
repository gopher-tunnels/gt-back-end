/**
 * This module implements a two-layer graph where:
 * - Tunnel layer: Precomputed A* paths through the GopherWay tunnel network
 * - Outdoor layer: Haversine distance × penalty for surface-level walking
 *
 * The graph uses building_nodes as vertices. At route time, Dijkstra's algorithm
 * selects the optimal mix of tunnel and outdoor edges based on user preference.
 *
 * @module multiLayerGraph
 */

import type { BuildingNode } from '../types/nodes';
import type { RouteStep, RouteSegment } from '../types/route';
import { GraphLayerType } from '../types/route';
import { haversineDistance } from '../utils/math';
import { OUTDOOR_PENALTY_BY_PREFERENCE, type RoutingPreference, ROUTING_CONFIG } from '../config/routing';

export { GraphLayerType } from '../types/route';

// INREMENT WHEN GRAPH VERSION CHANGES TO FORCE REBUILD
export const CACHE_VERSION = 4;

// Serialized Graph Cache
export interface GraphCache {
  version: number;
  builtAt: string;
  nodes: BuildingNode[];
  tunnelEdges: { from: string; to: string; cost: number; steps: RouteStep[] }[];
  disconnectedBuildings: BuildingNode[];
}

/**
 * Serializes the in-memory graph to a cacheable format.
 * Called after graph precomputation to save to disk.
 */
export function serializeGraph(): GraphCache {
  return {
    version: CACHE_VERSION,
    builtAt: new Date().toISOString(),
    nodes: Array.from(nodes.values()),
    tunnelEdges: Array.from(tunnelEdges.entries()).flatMap(([from, toMap]) =>
      Array.from(toMap.entries()).map(([to, edge]) => ({ from, to, cost: edge.cost, steps: edge.steps })),
    ),
    disconnectedBuildings: Array.from(disconnectedBuildings.values()),
  };
}

export function loadGraph(cache: GraphCache): void {
  for (const node of cache.nodes) registerNode(node);
  for (const { from, to, cost, steps } of cache.tunnelEdges) setTunnelEdge(from, to, { cost, steps });
  for (const node of cache.disconnectedBuildings ?? []) registerDisconnectedBuilding(node);
}

export function getGraphInfo(): { nodeCount: number; tunnelEdgeCount: number; disconnectedBuildingCount: number } {
  let edgeCount = 0;
  for (const toMap of tunnelEdges.values()) edgeCount += toMap.size;
  return { nodeCount: nodes.size, tunnelEdgeCount: edgeCount, disconnectedBuildingCount: disconnectedBuildings.size };
}

export interface TunnelEdge {
  cost: number;
  steps: RouteStep[];
}

// building_name -> BuildingNode (tunnel-connected only)
const nodes = new Map<string, BuildingNode>();

// building_name -> BuildingNode (not connected to tunnel network)
const disconnectedBuildings = new Map<string, BuildingNode>();

// Directional tunnel edges: from (building) -> to (building) -> TunnelEdge
const tunnelEdges = new Map<string, Map<string, TunnelEdge>>();

export function registerNode(node: BuildingNode): void {
  nodes.set(node.buildingName, node);
}

export function registerDisconnectedBuilding(node: BuildingNode): void {
  disconnectedBuildings.set(node.buildingName, node);
}

export function getDisconnectedBuilding(name: string): BuildingNode | undefined {
  return disconnectedBuildings.get(name);
}

export function setTunnelEdge(from: string, to: string, edge: TunnelEdge): void {
  if (!tunnelEdges.has(from)) tunnelEdges.set(from, new Map());
  tunnelEdges.get(from)!.set(to, edge);
}

export function getAllNodes(): BuildingNode[] {
  return Array.from(nodes.values());
}

export function getNode(name: string): BuildingNode | undefined {
  return nodes.get(name);
}

/**
 * Finds the optimal route between two buildings using Dijkstra's algorithm.
 *
 * The algorithm considers both tunnel and outdoor edges:
 * - **Tunnel edges**: Use precomputed A* cost (fast, cached)
 * - **Outdoor edges**: Use haversine distance × preference penalty
 *
 * Outdoor penalties by preference:
 * - `indoor`: 3.0× (strongly favor tunnels)
 * - `balanced`: 1.5× (moderate preference)
 * - `fastest`: 1.0× (pure distance optimization)
 *
 * @param startName - Building name to start from
 * @param endName - Building name to route to
 * @param preference - Routing preference affecting outdoor penalty
 * @returns Array of RouteSegments, or null if no path exists
 */
export function findRoute(
  startName: string,
  endName: string,
  preference: RoutingPreference = ROUTING_CONFIG.DEFAULT_PREFERENCE,
): RouteSegment[] | null {
  if (!nodes.has(startName) || !nodes.has(endName)) return null;
  if (startName === endName) return [];

  const outdoorPenalty = OUTDOOR_PENALTY_BY_PREFERENCE[preference];
  const allNames = Array.from(nodes.keys());

  const dist = new Map<string, number>(allNames.map((n) => [n, Infinity]));
  const prev = new Map<string, { from: string; type: GraphLayerType } | null>();
  dist.set(startName, 0);
  prev.set(startName, null);

  const unvisited = new Set(allNames);

  while (unvisited.size > 0) {
    // Pick unvisited node with minimum dist
    let u = '';
    let uDist = Infinity;
    for (const name of unvisited) {
      const d = dist.get(name)!;
      if (d < uDist) { uDist = d; u = name; }
    }

    if (!u || uDist === Infinity) break;
    if (u === endName) break;
    unvisited.delete(u);

    const uNode = nodes.get(u)!;
    const uTunnels = tunnelEdges.get(u);

    for (const v of unvisited) {
      const vNode = nodes.get(v)!;
      const tunnel = uTunnels?.get(v);
      const edgeCost = tunnel
        ? tunnel.cost
        : haversineDistance(uNode, vNode) * 1000 * outdoorPenalty;

      const alt = uDist + edgeCost;
      if (alt < dist.get(v)!) {
        dist.set(v, alt);
        prev.set(v, { from: u, type: tunnel ? GraphLayerType.Tunnel : GraphLayerType.Outdoor });
      }
    }
  }

  if (dist.get(endName) === Infinity) return null;

  // Reconstruct path
  const segments: RouteSegment[] = [];
  let cur = endName;

  while (true) {
    const entry = prev.get(cur);
    if (entry === undefined) return null;
    if (entry === null) break; // reached start

    const fromNode = nodes.get(entry.from)!;
    const toNode = nodes.get(cur)!;

    if (entry.type === GraphLayerType.Tunnel) {
      const edge = tunnelEdges.get(entry.from)!.get(cur)!;
      segments.unshift({ type: GraphLayerType.Tunnel, from: fromNode, to: toNode, steps: edge.steps, cost: edge.cost });
    } else {
      segments.unshift({ type: GraphLayerType.Outdoor, from: fromNode, to: toNode, cost: haversineDistance(fromNode, toNode) * 1000 });
    }

    cur = entry.from;
  }

  return segments;
}
