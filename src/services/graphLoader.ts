import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { loadGraph, CACHE_VERSION } from './multiLayerGraph';

const CACHE_PATH = resolve(__dirname, '../../graph.cache.json');

export async function loadCache(): Promise<void> {
  const raw = await readFile(CACHE_PATH, 'utf-8');
  const cache = JSON.parse(raw);

  if (cache.version !== CACHE_VERSION) {
    throw new Error(`[Graph] Cache version mismatch (expected ${CACHE_VERSION}, got ${cache.version}) — run scripts/rebuildGraph.ts`);
  }

  loadGraph(cache);
  const builtAt = cache.builtAt ? new Date(cache.builtAt).toLocaleString() : 'unknown';
  console.log(`[Graph] Loaded - ${cache.nodes.length} nodes, ${cache.tunnelEdges.length} tunnel edges (built ${builtAt})`);
}
