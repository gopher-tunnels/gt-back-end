import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { Session, Node, Path } from 'neo4j-driver';
import { driver } from '../controller/db';
import { getInstruction } from '../utils/routing/getInstruction';
import type { RouteStep } from '../types/route';
import { registerNode, registerDisconnectedBuilding, setTunnelEdge, serializeGraph, loadGraph, CACHE_VERSION } from './multiLayerGraph';

const CONCURRENCY = 20; // 20 threads possible for querying Neo4j
const CACHE_PATH = resolve(__dirname, '../../graph.cache.json');

function parseEntranceNodes(raw: string | null, buildingName: string): { latitude: number; longitude: number }[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { lon: number; lat: number }[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((e) => ({ latitude: e.lat, longitude: e.lon }));
    }
  } catch {
    console.warn(`[Graph] Failed to parse entrance_nodes for ${buildingName}`);
  }
  return undefined;
}

async function runAstar(session: Session, startName: string, endName: string): Promise<{ steps: RouteStep[]; weight: number } | null> {
  const { records } = await session.executeRead((tx) =>
    tx.run(
      `
      MATCH (start:Node {building_name: $startName, node_type: 'building_node'})
      WITH start
      MATCH (end:Node {building_name: $endName, node_type: 'building_node'})
      CALL apoc.algo.aStar(start, end, 'CONNECTED_TO', 'distance', 'latitude', 'longitude')
      YIELD path, weight
      RETURN path, weight
      `,
      { startName, endName },
    ),
  );

  if (!records.length) return null;

  const path = records[0].get('path') as Path;
  const weight = records[0].get('weight') as number;
  const nodes: Node[] = [path.start, ...path.segments.map((s) => s.end)];

  return {
    weight,
    steps: nodes.map((node, index): RouteStep => ({
      buildingName: node.properties.building_name,
      latitude: node.properties.latitude,
      longitude: node.properties.longitude,
      id: node.identity.toNumber(),
      floor: node.properties.floor,
      nodeType: node.properties.node_type,
      type: 'GT',
      instruction: getInstruction(node, index, nodes),
    })),
  };
}

/**
 * Attempts to load the graph from cache.
 * @returns The cache build date if loaded successfully, null otherwise
 */
export async function loadFromCacheIfExists(): Promise<Date | null> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf-8');
    const cache = JSON.parse(raw);

    if (cache.version !== CACHE_VERSION) {
      console.warn(`[Graph] Cache version mismatch (expected ${CACHE_VERSION}, got ${cache.version}) - rebuilding`);
      return null;
    }

    if (!Array.isArray(cache.nodes) || !Array.isArray(cache.tunnelEdges)) {
      console.warn('[Graph] Cache structure invalid (missing nodes or tunnelEdges array) - rebuilding');
      return null;
    }

    loadGraph(cache);
    const cacheAge = cache.builtAt ? new Date(cache.builtAt) : new Date();
    const ageStr = cache.builtAt ? ` (built ${cacheAge.toLocaleString()})` : '';
    console.log(`[Graph] Loaded from cache - ${cache.nodes.length} nodes, ${cache.tunnelEdges.length} tunnel edges${ageStr}`);
    return cacheAge;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;

    if (error.code === 'ENOENT') {
      console.log('[Graph] No cache file found - will build from Neo4j');
    } else if (err instanceof SyntaxError) {
      console.error(`[Graph] Cache file corrupted (invalid JSON): ${err.message}`);
    } else {
      console.error(`[Graph] Failed to load cache: ${error.message || error}`);
    }

    return null;
  }
}

export async function buildGraph(session: Session): Promise<Date | null> {
  if (process.env.REBUILD_GRAPH !== 'true') {
    const cacheAge = await loadFromCacheIfExists();
    if (cacheAge) return cacheAge;
  } else {
    console.log('[Graph] REBUILD_GRAPH=true — ignoring cache, rebuilding from Neo4j');
  }

  console.log('[Graph] Loading building nodes...');

  const { records } = await session.executeRead((tx) =>
    tx.run(`
      MATCH (n:Node { node_type: "building_node" })
      OPTIONAL MATCH (b:Building { building_name: n.building_name })
      RETURN id(n) AS id, n.building_name AS name, n.latitude AS latitude, n.longitude AS longitude,
             b.entrance_nodes AS entranceNodes
    `),
  );

  const buildingNodes = records.map((r) => {
    const name = r.get('name') as string;
    const entranceNodes = parseEntranceNodes(r.get('entranceNodes') as string | null, name);
    return {
      id: r.get('id').toNumber(),
      buildingName: name,
      latitude: r.get('latitude') as number,
      longitude: r.get('longitude') as number,
      ...(entranceNodes ? { entranceNodes } : {}),
    };
  });

  // GRAPH_JSON_PATH: override entrance_nodes from a local JSON file (useful for testing without re-importing to Neo4j)
  const graphJsonPath = process.env.GRAPH_JSON_PATH;
  if (graphJsonPath) {
    const raw = await readFile(resolve(graphJsonPath), 'utf-8');
    const graphData = JSON.parse(raw) as { nodes: { type: string; building_name?: string; entrance_nodes?: { lon: number; lat: number }[] }[] };
    const entranceOverrides = new Map<string, { latitude: number; longitude: number }[]>();
    for (const node of graphData.nodes) {
      if (node.type === 'building' && node.building_name && node.entrance_nodes?.length) {
        entranceOverrides.set(node.building_name, node.entrance_nodes.map((e) => ({ latitude: e.lat, longitude: e.lon })));
      }
    }
    for (const node of buildingNodes) {
      const override = entranceOverrides.get(node.buildingName);
      if (override) node.entranceNodes = override;
    }
    console.log(`[Graph] Applied entrance_nodes overrides from ${graphJsonPath} (${entranceOverrides.size} buildings)`);
  }

  for (const node of buildingNodes) registerNode(node);
  console.log(`[Graph] Registered ${buildingNodes.length} building nodes`);

  // Fetch disconnected buildings (have no building_node) for offline coord lookup
  const { records: disconnectedRecords } = await session.executeRead((tx) =>
    tx.run(`
      MATCH (b:Building)
      WHERE NOT b:TunnelBuilding
      RETURN b.building_name AS name, b.latitude AS latitude, b.longitude AS longitude,
             b.entrance_nodes AS entranceNodes
    `),
  );

  for (const r of disconnectedRecords) {
    const name = r.get('name') as string;
    const entranceNodes = parseEntranceNodes(r.get('entranceNodes') as string | null, name);
    registerDisconnectedBuilding({
      id: name,
      buildingName: name,
      latitude: r.get('latitude') as number,
      longitude: r.get('longitude') as number,
      ...(entranceNodes ? { entranceNodes } : {}),
    });
  }
  console.log(`[Graph] Registered ${disconnectedRecords.length} disconnected buildings`);

  const pairs: [string, string][] = [];
  for (const a of buildingNodes)
    for (const b of buildingNodes)
      if (a.buildingName !== b.buildingName) pairs.push([a.buildingName, b.buildingName]);

  const totalPairs = pairs.length;
  console.log(`[Graph] Precomputing ${totalPairs} tunnel routes (concurrency: ${CONCURRENCY})...`);

  let pairsProcessed = 0;
  let validEdges = 0;
  const startTime = Date.now();
  const progressInterval = Math.max(100, Math.floor(totalPairs / 10)); // Log every 10% or 100 pairs

  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async ([a, b]) => {
      const s = driver.session({ database: 'neo4j' });
      try {
        const result = await runAstar(s, a, b);
        if (result) setTunnelEdge(a, b, { cost: result.weight, steps: result.steps });
        return result ? 1 : 0;
      } finally {
        await s.close();
      }
    }));

    pairsProcessed += batch.length;
    validEdges += results.reduce((sum: number, n: number) => sum + n, 0);

    // Log progress every ~10%
    if (pairsProcessed % progressInterval < CONCURRENCY || pairsProcessed === totalPairs) {
      const elapsed = (Date.now() - startTime) / 1000;
      const percent = ((pairsProcessed / totalPairs) * 100).toFixed(1);
      const rate = pairsProcessed / elapsed;
      const remaining = totalPairs - pairsProcessed;
      const eta = remaining > 0 ? Math.round(remaining / rate) : 0;

      console.log(
        `[Graph] Progress: ${pairsProcessed}/${totalPairs} pairs (${percent}%) - ` +
        `${validEdges} edges found - ${elapsed.toFixed(1)}s elapsed` +
        (eta > 0 ? `, ~${eta}s remaining` : '')
      );
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Graph] Complete - ${validEdges} tunnel edges computed in ${totalTime}s`);
  const cache = serializeGraph();
  await writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8');
  console.log(`[Graph] Cache saved to ${CACHE_PATH}`);
  return null;
}
