# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GopherTunnels back-end API: A campus navigation system for the University of Minnesota that routes pedestrians through underground tunnels (GopherWay). Built with Express.js, TypeScript, and Neo4j graph database.

## Development Commands

```bash
yarn install
npm run dev    # hot reload
npm run build  # compile TypeScript
npm run start  # production
```

## USE RELATIVE PATHS INSTEAD OF ABSOLUTE PATHS

## Required Environment Variables

- `PORT` - Server port
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` - Neo4j connection
- `MAPBOX_API_KEY` - Mapbox Directions API + Tilequery API (sidewalk snapping)
- `TRUST_PROXY` - Express trust proxy setting
- `API_SHARED_SECRET_ACTIVE` - HMAC signing secret (required for POST/PUT/DELETE)
- `API_SHARED_SECRET_OLD` - (Optional) Previous secret for rotation

## Architecture

### Routing Flow

The main `/api/routing/route` endpoint uses a **precomputed multilayer graph** (tunnel + outdoor layers) queried via Dijkstra at request time.

**Early exit:** If user < 100m from target → return Mapbox-only direct walk.

**Normal flow:**
1. Determine start `building_node` (inside building check or nearest candidate)
2. Run Dijkstra on the in-memory multilayer graph
3. Execute each segment: tunnel edges use cached steps, outdoor edges call Mapbox
4. If target has no `building_node`, route to nearest node then final Mapbox leg

### Multilayer Graph (`src/services/multiLayerGraph.ts`)

The core routing structure. `building_node`s are the only vertices — they are the transition points between tunnel and outdoor layers.

- **Tunnel edges**: precomputed A* cost + full `RouteStep[]` between every reachable pair of `building_node`s
- **Outdoor edges**: haversine × outdoor penalty between any pair, always available — guarantees a path always exists
- **Dijkstra** selects the optimal mix at route time using `OUTDOOR_PENALTY_BY_PREFERENCE`

**Reliability:** Disconnected tunnel components are bridged automatically via outdoor edges. No special-casing for `Disconnected_Building` — Dijkstra handles it natively.

### Graph Precomputer (`src/services/graphPrecomputer.ts`)

Runs at server startup. Loads all `building_node`s from Neo4j, then runs A* for all directed pairs (N×(N-1)) in parallel batches (CONCURRENCY=20). Disconnected pairs fail fast. Results are stored as tunnel edges in the multilayer graph.

Currently rebuilds from Neo4j every startup. **See planned features for disk cache.**

### Route Builder (`src/services/routeBuilder.ts`)

- `aggregateRoute()` - Combines N executed segments into final `RouteResult`
- `buildMapboxSegment()` - Builds walking segment with sidewalk snapping
- `handleDirectWalk()` - Early exit for close destinations
- `findUserInsideBuilding()` - Detects if user is inside a building node

### Mapbox Service (`src/services/mapbox.ts`)

Handles Mapbox Directions API with **sidewalk snapping**:
- `getMapboxWalkingDirections()` - Main directions fetch with optional snapping
- `snapToNearestSidewalk()` - Prevents indoor routing by snapping coords to nearby roads
- Direction-aware snapping (70% direction weight, 30% distance weight)

### Start Node Selection (`src/utils/routing/closestNodes.ts`)

`getCandidateStartNodes()` finds optimal tunnel entry point:
- Filters nodes within `FORWARD_DIRECTION_LEEWAY_FACTOR` of user-to-destination distance
- Scores by: outdoor distance + direction alignment penalty
- Penalizes using target building directly (prefer intermediate access)

### Math Utilities (`src/utils/math.ts`)

`haversineDistance()`, `calculateBearing()`, `angularDifference()`, `toRadians()`

### Node Types in Neo4j

- `Building` / `Disconnected_Building` - Campus buildings
- `Node` with `node_type`: `building_node`, `path`, `elevator`
- `Nonce` - Replay protection for HMAC-signed requests

### Key Services

- `src/services/astar.ts` - A* pathfinding via `apoc.algo.aStar`
- `src/services/buildings.ts` - `getBuildingCoords()` only
- `src/services/visits.ts` - Building visit tracking
- `src/middleware/security.ts` - Rate limiting and HMAC signature verification

### Routing Config (`src/config/routing.ts`)

- `OUTDOOR_PENALTY_BY_PREFERENCE`: indoor=3.0, balanced=1.5, fastest=1.0
- `MIN_DIRECT_WALK_METERS`: 100m threshold for direct walk early exit
- `INSIDE_BUILDING_METERS`: 25m threshold for inside-building detection
- `WALKING_SPEED_MPS`: 1.4 m/s used for tunnel time estimation
- `FORWARD_DIRECTION_LEEWAY_FACTOR`, `MAX_START_NODES`, `DIRECTION_ANGLE_WEIGHT`, `TARGET_BUILDING_PENALTY_MULTIPLIER`

### Security Layer

- GET requests: Rate-limited only
- POST/PUT/DELETE: Require HMAC signature with headers `X-Device-Id`, `X-Timestamp`, `X-Nonce`, `X-Signature`
- Replay protection stores nonces in Neo4j with TTL

## API Endpoints

All endpoints under `/api/routing`:
- `GET /route?targetBuilding=X&latitude=Y&longitude=Z` - Get navigation route
- `GET /buildings` - List all buildings (includes `isDisconnected` flag)
- `GET /popular` - Top 5 most visited buildings
- `GET /search?input=X` - Fuzzy search buildings

Swagger docs at `/api-docs`.

## Tech Debt

### High Priority

**Intermediate GT segment instructions are wrong** — when Dijkstra produces multiple consecutive tunnel segments (e.g. `GT → GT`), the last step of each intermediate segment incorrectly shows `"You've arrived!"` and the next segment starts with `"Enter the GopherWay"`. These boundary instructions need to be patched in the controller when building `executed` segments.

**`any` types remaining:**
- `routing.controller.ts` - executed segment steps
- `astar.ts:43` - `(s: any)` should be `PathSegment`
- `routeBuilder.ts` - Mapbox step mapping
- `mapbox.ts` - Waypoint logging

### Low Priority

- Commented import in `index.ts` line 7 - delete if not needed
- TODOs in code: visits spam protection, vector normalization in closestNodes.ts

## Planned Features

### Graph Disk Cache (Full Offline + Fast Startup)

**Goal:** Full offline capability after first run. Startup should not require Neo4j once the cache exists.

**Plan:**
- After `buildGraph()` completes, serialize the graph to `graph.cache.json`:
  ```json
  {
    "nodes": [{ "id": 1, "buildingName": "...", "latitude": 0, "longitude": 0 }],
    "tunnelEdges": [{ "from": "A", "to": "B", "cost": 150, "steps": [...] }]
  }
  ```
- On startup, check if `graph.cache.json` exists → load it and skip Neo4j entirely
- Add `--rebuild` CLI flag or admin endpoint to force fresh precompute from Neo4j
- Add `graph.cache.json` to `.gitignore`
- Estimated size: 1-5MB (only connected pairs are stored)

**Files to modify:**
- `src/services/multiLayerGraph.ts` — add `serializeGraph()` and `loadGraph()` functions
- `src/services/graphPrecomputer.ts` — check for cache file first; save after full build

### Fix Intermediate GT Segment Instructions

When the route has consecutive `GT` segments, patch the boundary:
- Remove `"You've arrived!"` from the last step of non-final GT segments
- Remove `"Enter the GopherWay"` from the first step of non-first GT segments
- Handle in `routing.controller.ts` when building the `executed` array

### Skip Mapbox for Short Distances

When an outdoor segment origin/destination are very close (< 60m), skip Mapbox and return a simple two-point segment. Add `MIN_MAPBOX_SEGMENT_METERS` to `routing.ts`.