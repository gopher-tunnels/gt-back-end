/**
 * Rebuilds graph.cache.json from Neo4j.
 * Run from project root: npx ts-node scripts/rebuildGraph.ts
 */
import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { Session, Node, Path } from 'neo4j-driver';
import { driver } from '../src/controller/db';
import { getInstruction } from '../src/utils/routing/getInstruction';
import type { RouteStep } from '../src/types/route';
import {
  registerNode,
  registerDisconnectedBuilding,
  setTunnelEdge,
  serializeGraph,
  CACHE_VERSION,
} from '../src/services/multiLayerGraph';

const CONCURRENCY = 20;
const CACHE_PATH = resolve(__dirname, '../graph.cache.json');

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

async function main(): Promise<void> {
  console.log(`[Graph] Cache version: ${CACHE_VERSION}`);
  console.log('[Graph] Loading building nodes...');

  const session = driver.session({ database: 'neo4j' });

  try {
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

    for (const node of buildingNodes) registerNode(node);
    console.log(`[Graph] Registered ${buildingNodes.length} building nodes`);

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
    const progressInterval = Math.max(100, Math.floor(totalPairs / 10));

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

      if (pairsProcessed % progressInterval < CONCURRENCY || pairsProcessed === totalPairs) {
        const elapsed = (Date.now() - startTime) / 1000;
        const percent = ((pairsProcessed / totalPairs) * 100).toFixed(1);
        const rate = pairsProcessed / elapsed;
        const remaining = totalPairs - pairsProcessed;
        const eta = remaining > 0 ? Math.round(remaining / rate) : 0;

        console.log(
          `[Graph] Progress: ${pairsProcessed}/${totalPairs} pairs (${percent}%) - ` +
          `${validEdges} edges found - ${elapsed.toFixed(1)}s elapsed` +
          (eta > 0 ? `, ~${eta}s remaining` : ''),
        );
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Graph] Complete - ${validEdges} tunnel edges computed in ${totalTime}s`);

    const cache = serializeGraph();
    await writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8');
    console.log(`[Graph] Cache saved to ${CACHE_PATH}`);
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error('[rebuildGraph] Fatal:', err);
  process.exit(1);
});
