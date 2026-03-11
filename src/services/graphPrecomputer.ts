import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { Session } from 'neo4j-driver';
import { driver } from '../controller/db';
import { astar } from './astar';
import { registerNode, setTunnelEdge, serializeGraph, loadGraph, CACHE_VERSION } from './multiLayerGraph';

const CONCURRENCY = 20;
const CACHE_PATH = resolve(__dirname, '../../graph.cache.json');

async function tryLoadCache(): Promise<boolean> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf-8');
    const cache = JSON.parse(raw);
    if (cache.version !== CACHE_VERSION) {
      console.warn(`[Graph] Cache version mismatch (expected ${CACHE_VERSION}, got ${cache.version}) — rebuilding`);
      return false;
    }
    loadGraph(cache);
    console.log(`[Graph] Loaded from cache — ${cache.nodes.length} nodes, ${cache.tunnelEdges.length} tunnel edges (built ${cache.builtAt})`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempts to load graph from disk cache only. Used when SKIP_GRAPH_BUILD=true.
 * Routes will fail gracefully if no cache exists.
 */
export async function loadFromCacheIfExists(): Promise<void> {
  const loaded = await tryLoadCache();
  if (!loaded) console.warn('[Graph] No valid cache found — routes will fail. Run without SKIP_GRAPH_BUILD to build.');
}

/**
 * Loads all building_nodes and precomputes tunnel edges between every reachable pair.
 * Checks for a disk cache first (skipped if REBUILD_GRAPH=true).
 * After a fresh build, saves the cache to disk for subsequent startups.
 */
export async function buildGraph(session: Session): Promise<void> {
  if (process.env.REBUILD_GRAPH !== 'true') {
    const loaded = await tryLoadCache();
    if (loaded) return;
  } else {
    console.log('[Graph] REBUILD_GRAPH=true — ignoring cache, rebuilding from Neo4j');
  }

  console.log('[Graph] Loading building nodes...');

  const { records } = await session.executeRead((tx) =>
    tx.run(`
      MATCH (n:Node { node_type: "building_node" })
      RETURN id(n) AS id, n.building_name AS name, n.latitude AS latitude, n.longitude AS longitude
    `),
  );

  const buildingNodes = records.map((r) => ({
    id: r.get('id').toNumber(),
    buildingName: r.get('name') as string,
    latitude: r.get('latitude') as number,
    longitude: r.get('longitude') as number,
  }));

  for (const node of buildingNodes) registerNode(node);
  console.log(`[Graph] Registered ${buildingNodes.length} building nodes`);

  // All directed pairs (a→b) — both directions for correct turn instructions
  const pairs: [string, string][] = [];
  for (const a of buildingNodes) {
    for (const b of buildingNodes) {
      if (a.buildingName !== b.buildingName) {
        pairs.push([a.buildingName, b.buildingName]);
      }
    }
  }

  console.log(`[Graph] Precomputing ${pairs.length} tunnel routes (concurrency: ${CONCURRENCY})...`);

  let computed = 0;

  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY);

    const results = await Promise.all(batch.map(async ([a, b]) => {
      const s = driver.session({ database: 'neo4j' });
      try {
        const result = await astar(s, a, b);
        if (result) setTunnelEdge(a, b, { cost: result.weight, steps: result.steps });
        return result ? 1 : 0;
      } finally {
        await s.close();
      }
    }));

    computed += results.reduce((sum, n) => sum + n, 0 as number);
  }

  console.log(`[Graph] Done — ${computed} tunnel edges precomputed`);

  const cache = serializeGraph();
  await writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8');
  console.log(`[Graph] Cache saved to ${CACHE_PATH}`);
}
