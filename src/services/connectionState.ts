// Holds the status of neo4j/graph connection
export interface ConnectionState {
  neo4jAvailable: boolean;
  graphLoaded: boolean;
  offlineMode: boolean;
  cacheAge: Date | null; // When the loaded cache was built (null if built fresh or not loaded) 
}

let state: ConnectionState = {
  neo4jAvailable: false,
  graphLoaded: false,
  offlineMode: process.env.OFFLINE_MODE === 'true',
  cacheAge: null,
};

// Gets a read-only snapshot of the state
export function getConnectionState(): Readonly<ConnectionState> {
  return state;
}

export function setNeo4jAvailable(available: boolean): void {
  state = { ...state, neo4jAvailable: available };
}

/**
 * Updates the graph loaded status.
 * @param loaded - Whether the graph has been loaded
 * @param cacheAge - When the cache was built (for cache-loaded graphs)
 */
export function setGraphLoaded(loaded: boolean, cacheAge?: Date): void {
  state = { ...state, graphLoaded: loaded, cacheAge: cacheAge ?? null };
}

/**
 * Returns true if routing queries can be served.
 * Routing is available if the graph has been loaded, regardless of Neo4j status.
 */
export function isRoutingAvailable(): boolean {
  return state.graphLoaded;
}

/**
 * Returns true if write operations (incrementBuildingVisit, etc.) can be performed.
 * Writes require Neo4j to be available and not in explicit offline mode.
 */
export function isWriteAvailable(): boolean {
  return state.neo4jAvailable && !state.offlineMode;
}
