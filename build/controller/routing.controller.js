"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILDINGS = exports.session = exports.driver = void 0;
exports.buildingRouting = buildingRouting;
exports.popularRoutes = popularRoutes;
exports.searchBar = searchBar;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const neo4j = require('neo4j-driver');
exports.BUILDINGS = [];
// connecting to database and load static data
(() => __awaiter(void 0, void 0, void 0, function* () {
    const URI = process.env.NEO4J_URI;
    const USER = process.env.NEO4J_USERNAME;
    const PASSWORD = process.env.NEO4J_PASSWORD;
    // const info: { start: any, destinations: any[] }[] = []
    // debugging and connecting
    try {
        exports.driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
        const serverInfo = yield exports.driver.getServerInfo();
        console.log('Connection estabilished');
        console.log(serverInfo);
        exports.session = exports.driver.session({ database: 'neo4j' });
        // might be a stupid long-term solution, but works for now
        const { records, summary } = yield exports.session.executeRead((tx) => __awaiter(void 0, void 0, void 0, function* () { return yield tx.run(`MATCH (b:building) RETURN b`); }) // might just take name?
        );
        exports.BUILDINGS = records.map(record => record.get("b").properties).filter(props => props.name != undefined);
    }
    catch (err) {
        console.log(`Connection error\n${err}\nCause: ${err.cause}`);
    }
}))();
// establish a valid session
function buildingRouting(req, res, next) {
    (() => __awaiter(this, void 0, void 0, function* () {
        // instead of going forwards, go backwards to find user location, getting to closest building
        // have a confidece bound of some sort (greedy) 
        // const MAPTOKEN = process.env.MAPTOKEN
        // const start: {longitude: Number, latitude: Number} | any = req.query.start
        // const destination: {longitude: Number, latitude: Number} | any = req.query.destination
        const start = req.query.start;
        const destination = req.query.destination;
        // try {
        //   const query = axios.get(
        //             `https://api.mapbox.com/directions/v5/mapbox/walking/${start.longitude},${start.latitude};${destination.longitude},${destination.latitude}?steps=true&geometries=geojson&access_token=${MAPTOKEN}`,
        //         ).then((response) => {
        //             console.log(response)
        //             // const json = response.json();
        //             // const data = json.routes[0];
        //             // const route = data.geometry.coordinates;
        //             // console.log(json.routes);
        //             // console.log(json.routes[0].legs[0].steps);
        //             return response
        //         })
        // } catch (err: any) {
        //   console.log("Query issue")
        // }
        // shortest route example
        let { records, summary } = yield exports.session.executeRead((tx) => __awaiter(this, void 0, void 0, function* () {
            return yield tx.run(`MATCH p=shortestPath(
            (start:building {name: \"${start}\"})-[:CONNECTED_TO]-(destination:building {name: \"${destination}\"}))
            WHERE start.campus == destination.campus
            RETURN p`);
        }));
        // processed path that is returned
        let path;
        let route = [];
        // processes intermediary and destination nodes
        for (let record of records) {
            path = record.get('p').segments;
            const start_location = path[0].start;
            route.push({
                name: start_location.properties.name,
                location: {
                    latitude: start_location.properties.latitude,
                    longitude: start_location.properties.longitude
                }
            });
            for (let segment of path) {
                let node = segment.end;
                route.push({
                    name: node.properties.name,
                    location: {
                        latitude: node.properties.latitude,
                        longitude: node.properties.longitude
                    }
                });
            }
        }
        // Create or update the ROUTED_TO relationship with visits property
        try {
            let result = yield exports.session.executeWrite((tx) => __awaiter(this, void 0, void 0, function* () {
                return yield tx.run(`
          MATCH (startNode:building {name: $start}), (endNode:building {name: $destination})
          MERGE (startNode)-[r:ROUTED_TO]->(endNode)
          ON CREATE SET r.visits = 1
          ON MATCH SET r.visits = r.visits + 1
          RETURN r.visits AS visits
          `, { start, destination });
            }));
            // Retrieve and log the visits count (NOT NEEDED, FOR VERIFICATION)
            if (result.records.length > 0) {
                const visits = result.records[0].get('visits');
                console.log(`ROUTED_TO connection exists with visits: ${visits}`);
            }
            else {
                console.log("Failed to retrieve the visits count.");
            }
        }
        catch (error) {
            console.error("Error creating or updating ROUTED_TO relationship:", error);
        }
        res.json(route);
    }))();
}
// gets top 5 popular routes
function popularRoutes(req, res, next) {
    (() => __awaiter(this, void 0, void 0, function* () {
        let { records, summary } = yield exports.session.executeRead((tx) => __awaiter(this, void 0, void 0, function* () {
            return yield tx.run(`
          MATCH (a)-[b:ROUTED_TO]->(c) 
          RETURN a.name AS start, c.name AS destination, b.visits AS visits, b.path AS path
          ORDER BY visits DESC
          LIMIT 5
        `);
        }));
        const routes = [];
        for (const record of records) {
            const route = {};
            for (const field of record.keys)
                field == "visits" ? route[field] = record.get(field).low : route[field] = record.get(field);
            routes.push(route);
        }
        res.json({ routes: routes });
    }))();
}
// could be improved with a fuzzy find or some sorting
function searchBar(req, res) {
    (() => __awaiter(this, void 0, void 0, function* () {
        var _a;
        let input = (_a = req.query.input) === null || _a === void 0 ? void 0 : _a.toString().toLowerCase();
        const matches = exports.BUILDINGS.filter(building => building.name.toLowerCase().includes(input)).slice(0, 5);
        res.json(matches);
    }))();
}
// close database connection when app is exited
process.on("exit", (code) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield exports.session.close();
        yield exports.driver.close();
    }
    catch (_a) {
        console.log("Database connection failed to close");
    }
}));
