import type { BuildingNode, RouteStep } from '../types/nodes';
import { haversineDistance } from '../utils/math';
import { OUTDOOR_PENALTY_BY_PREFERENCE, type RoutingPreference, ROUTING_CONFIG } from '../config/routing';

export const CACHE_VERSION = 3;

export interface GraphCache {
  version: number;
  builtAt: string;
  nodes: BuildingNode[];
  tunnelEdges: { from: string; to: string; cost: number; steps: RouteStep[] }[];
}

export function serializeGraph(): GraphCache {
  return {
    version: CACHE_VERSION,
    builtAt: new Date().toISOString(),
    nodes: Array.from(nodes.values()),
    tunnelEdges: Array.from(tunnelEdges.entries()).flatMap(([from, toMap]) =>
      Array.from(toMap.entries()).map(([to, edge]) => ({ from, to, cost: edge.cost, steps: edge.steps })),
    ),
  };
}

export function loadGraph(cache: GraphCache): void {
  for (const node of cache.nodes) registerNode(node);
  for (const { from, to, cost, steps } of cache.tunnelEdges) setTunnelEdge(from, to, { cost, steps });
}

export function getGraphInfo(): { nodeCount: number; tunnelEdgeCount: number } {
  let edgeCount = 0;
  for (const toMap of tunnelEdges.values()) edgeCount += toMap.size;
  return { nodeCount: nodes.size, tunnelEdgeCount: edgeCount };
}

export interface TunnelEdge {
  cost: number;
  steps: RouteStep[];
}

export interface RouteSegment {
  type: 'tunnel' | 'outdoor';
  from: BuildingNode;
  to: BuildingNode;
  steps?: RouteStep[];
  cost: number;
}

// building_name -> BuildingNode
const nodes = new Map<string, BuildingNode>();
// Directional tunnel edges: from -> to -> TunnelEdge
const tunnelEdges = new Map<string, Map<string, TunnelEdge>>();

export function registerNode(node: BuildingNode): void {
  nodes.set(node.buildingName, node);
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
 * Dijkstra over the multilayer graph.
 * Tunnel edges use precomputed A* cost; all other pairs use outdoor haversine × penalty.
 * Always finds a path if both nodes are registered (worst case: all outdoor).
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
  const prev = new Map<string, { from: string; type: 'tunnel' | 'outdoor' } | null>();
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
        prev.set(v, { from: u, type: tunnel ? 'tunnel' : 'outdoor' });
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

    if (entry.type === 'tunnel') {
      const edge = tunnelEdges.get(entry.from)!.get(cur)!;
      segments.unshift({ type: 'tunnel', from: fromNode, to: toNode, steps: edge.steps, cost: edge.cost });
    } else {
      segments.unshift({ type: 'outdoor', from: fromNode, to: toNode, cost: haversineDistance(fromNode, toNode) * 1000 });
    }

    cur = entry.from;
  }

  return segments;
}
