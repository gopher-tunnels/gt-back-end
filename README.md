# Gopher Tunnels Back-End

Welcome to the official Gopher Tunnels back-end repository!

## Environment setup

### 1. Clone the repository

```bash
git clone
```

### 2. Install dependencies

Yarn:

```bash
yarn
```

npm:

```bash
npm install
```

### 3. Run the dev environment

Yarn:

```bash
yarn dev
```

npm:

```bash
npm run dev
```

### 4. Connecting
**Install neo4j-driver-core and nodemon**

Yarn:

```bash
yarn add neo4j-driver-core nodemon
```

npm:

```bash
npm install neo4j-driver-core nodemon
```

For testing, ```npm run dev``` will start the server and connect to the database

**Routes**:

**Note**: for query parameters, ensure all characters in string are lowercase

1. '/route?'
- Service: routing from start to destination (between buildings only)
- Type: GET
- Query Params: (start: string), (destination: string)
  - Ex: http://localhost:PORT/route?start=tate&destination=smith
  - Will return an empty list if either query parameter isn't a building name or route isn't possible

2. '/search?'
- Service: search bar functionality
- Type: GET
- Query Params: (name: string)
  - Ex: 'http://localhost:PORT/route?name=g
  - Will return an empty list if search input doesn't match any building names

**Successful Connection to AuraDB**:

```bash
Connection estabilished
ServerInfo {
  address: ...,
  agent: 'Neo4j/5.21-aura',
  protocolVersion: 5.4
}
```

**Unsuccessful Connection**:

```bash
Connection error
Neo4jError: Could not perform discovery. No routing servers available. Known routing table: RoutingTable[database=default database, expirationTime=0, currentTime=1720306255689, routers=[], readers=[], writers=[]]
Cause: Neo4jError: Failed to connect to server. Please ensure that your database is listening on the correct host and port and that you have compatible encryption settings both on Neo4j server and driver. Note that the default encryption setting has changed in Neo4j 4.0. Caused by: getaddrinfo ENOTFOUND 45511ca4.databases.neo4j.io
C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\node_modules\neo4j-driver-core\lib\error.js:75
        _super.call(this, message, cause != null ? { cause: cause } : undefined) || this;
               ^
Neo4jError: Pool is closed, it is no more able to serve requests.
    at new Neo4jError (C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\node_modules\neo4j-driver-core\lib\error.js:75:16)
    at newError (C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\node_modules\neo4j-driver-core\lib\error.js:111:12)
    at Pool.<anonymous> (C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\lib\pool\pool.js:229:68)
    at step (C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\lib\pool\pool.js:49:23)
    at Object.next (C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\lib\pool\pool.js:30:53)
    at C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\lib\pool\pool.js:24:71
    at new Promise (<anonymous>)
    at __awaiter (C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\lib\pool\pool.js:20:12)
    at Pool._acquire (C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\lib\pool\pool.js:222:16)
    at Pool._processPendingAcquireRequests (C:\Users\zhiya\OneDrive\Desktop\test-node\gt-back-end\node_modules\neo4j-driver-bolt-connection\lib\pool\pool.js:401:22) {
  constructor: [Function: Neo4jError] { isRetriable: [Function (anonymous)] },
  code: 'N/A',
  retriable: false
}
```

**Common causes for connection error**:
- Instance is deleted or inactive
- Authentication credentials incorrect
- .env variables misconfigured

If you keep getting an unsuccessful connection to AuraDB, please bring it up!
