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
For testing, ```bash npm run dev ``` will start the server and connect to the database

Routes:
1. '/route?'
- Type: GET
- Query Params: (start: string), (destination: string)
- Service: routing from start to destination (between buildings only)

2. '/search?'
- Type: GET
- Query Params: (name: string)
- Service: search bar functionality
