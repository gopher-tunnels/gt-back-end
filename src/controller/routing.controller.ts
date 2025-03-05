import { Request, Response, NextFunction } from 'express';
import { ManagedTransaction, Session } from 'neo4j-driver-core';
import dotenv from 'dotenv';
import { findDir } from './utils/directions'
import {Vertex,Path,Query} from './routing.types'

dotenv.config();

const neo4j = require('neo4j-driver');
export let driver: any;
export let session: Session;

export let BUILDINGS: any[] = [];

// connecting to database and load static data
(async () => {
  const URI = process.env.NEO4J_URI
  const USER = process.env.NEO4J_USERNAME
  const PASSWORD = process.env.NEO4J_PASSWORD

  // const info: { start: any, destinations: any[] }[] = []

  // debugging and connecting

  try {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
    const serverInfo = await driver.getServerInfo()
    console.log('Connection estabilished')
    console.log(serverInfo)
    session = driver.session({ database: 'neo4j' });

    // might be a stupid long-term solution, but works for now
    const { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => await tx.run(`MATCH (b:building) RETURN b`) // might just take name?
    )
    BUILDINGS = records.map(record => record.get("b").properties).filter(props => props.name != undefined);
  } catch(err: any) {
    console.log(`Connection error\n${err}\nCause: ${err.cause}`)
  }

})();



const ns: Vertex[]=[
  {name:"Northrop",id: 1, kind: "start", latitude: 44.976606975468776, longitude:-93.23536993145039},
  {name:"Johnston Hall", id: 2, kind: "tunnel", latitude: 44.97595595602177, longitude:-93.2365941832571},
  {name:"Walter Library",id: 3, kind: "tunnel", latitude: 44.975340765715636, longitude: -93.23607071007078},
  {name:"Smith Hall",id: 4, kind: "tunnel", latitude:44.974594166673526, longitude: -93.23630711731622},
  {name:"Kolthoff Hall",id: 5, kind: "tunnel", latitude: 44.9740327177907, longitude: -93.23625645862076},
  {name:"Ford Hall",id: 6, kind: "tunnel", latitude:44.97405063645697, longitude:-93.23451717674367}, 
  {name:"Murphy Hall",id: 7, kind: "tunnel", latitude: 44.97464792212929, longitude: -93.23423011080278},
  {name:"John T. Tate Hall",id: 8, kind: "tunnel", latitude: 44.97535868397321, longitude: -93.23455094920729},
  {name:"Morrill Hall",id: 9, kind: "target", latitude: 44.975872338309486, longitude: -93.23452561985957}
]


export function getRoutes(req: Request, res: Response, next: NextFunction) {
  const visited=new Set<number>();
  const nodes:Vertex[]=[];
  const paths:Path[]=[];
  let target:number=0;
  let target_valid=false;
  for(let i=0;i<=8;i++){
    if(ns[i].name==req.query.target){
      visited.add(i);
      target=i;
      target_valid=true;
      break;
  }
}
  if(!target_valid){
    throw new Error("you must provide a valid target");
  }
  const { startLat, startLong}=req.query as unknown as Query;
  const start:Vertex={name:"start",id:66,kind:"start",latitude:startLat,longitude:startLong};
  nodes.push(start);
  let from=66;
  while(nodes.length<3){
  const randomNumber: number = Math.floor(Math.random() * 9);
  if(visited.has(randomNumber)){
    continue;
  }
  paths.push({from:from,to:randomNumber+1,attributes:[""]});
  from=randomNumber+1;
  ns[randomNumber].kind="tunnel";
  nodes.push(ns[randomNumber]);
  visited.add(randomNumber);
  
}
paths.push({from:from,to:target+1,attributes:[""]});
ns[target].kind="target";
nodes.push(ns[target]);
return res.json({nodes,paths});
}

export function getBuildings(req: Request, res: Response, next: NextFunction) {
  try{
    if (req.query.Select === "All") {
      res.json(JSON.stringify({ "buildings": BUILDINGS }))
    }
    else if (req.query.Select === "Some") {
      const idList = (req.query.IDlist as string)?.split(",") || [];
      if (!idList || !Array.isArray(idList)) {
        throw new Error("IDlist must be provided and must be an array");
      }
      res.json(JSON.stringify({ "buildings": BUILDINGS.filter(building => idList.includes(building.id)) }))
    }
    else if (req.query.Select === "No") {
      res.json(JSON.stringify({ "buildings": [] }))
    }
    else {
      const error: Error = new Error("The Select parameter must be one of 'All', 'Some', or 'No'.");
      next(error);
    }
  }
  catch (err: any) {
    console.log("Query issue")
    next(err)
  }
  
}


// establish a valid session
export function buildingRouting(req: Request, res: Response, next: NextFunction) {
  (async () => {
    // instead of going forwards, go backwards to find user location, getting to closest building
    // have a confidece bound of some sort (greedy) 
    // const MAPTOKEN = process.env.MAPTOKEN
    // const start: {longitude: Number, latitude: Number} | any = req.query.start
    // const destination: {longitude: Number, latitude: Number} | any = req.query.destination
    const start = String(req.query.start).toLowerCase()
    const destination = String(req.query.destination).toLowerCase()

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
    let { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => {
        return await tx.run(
            `MATCH p = SHORTEST 1 (start:building {name: \"${start}\"})-[:CONNECTED_TO]-+(destination:building {name: \"${destination}\"})
            WHERE start.campus = destination.campus
            RETURN p`
        )
      }
    )

    let route: { name: string, location: { latitude: string, longitude: string }, direction: string }[] = [];

    // processes intermediary and destination nodes
    const path = records[0].get('p').segments

    route.push(
      {
        name: path[0].start.properties.name,
        location: {
          latitude: path[0].start.properties.latitude,
          longitude: path[0].start.properties.longitude
        },
        direction: ""
      }
    )

    for (let segment of path) {
      const start_location = segment.end

      route.push(
        {
          name: start_location.properties.name,
          location: {
            latitude: start_location.properties.latitude,
            longitude: start_location.properties.longitude
          },
          direction: ""
        }
      )

      for (let i = 0; i < path.length - 1; i++) {
        let segment = path[i]
        let nextSegment = path[i + 1]
        let nodePrev = segment.start
        let node = segment.end
        let nodeNext = nextSegment.end
        route.push(
          {

            name: node.properties.name,
            location: {
              latitude: node.properties.latitude,
              longitude: node.properties.longitude,
            },
            direction: findDir(nodePrev.properties, node.properties, nodeNext.properties)
          }
        )
        if (i == path.length - 1) {
          route.push(
            {
              name: nodeNext.properties.name,
              location: {
                latitude: nodeNext.properties.latitude,
                longitude: nodeNext.properties.longitude,
            },
            direction: ""
          });
        }
      }
    }
       
    // Create or update the ROUTED_TO relationship with visits property
    try {
      let result = await session.executeWrite(async (tx: ManagedTransaction) => {
        return await tx.run(
          `
          MATCH (startNode:building {name: $start}), (endNode:building {name: $destination})
          MERGE (startNode)-[r:ROUTED_TO]->(endNode)
          ON CREATE SET r.visits = 1
          ON MATCH SET r.visits = r.visits + 1
          RETURN r.visits AS visits
          `,
          { start, destination }
        );
      });
    } catch (error) {
      console.error("Error creating or updating ROUTED_TO relationship:", error);
    }
    
    res.json(route);
  })()
}

export function userLocationRoute(req: Request, res: Response, next: NextFunction) {
  const request = {
    lat: parseFloat(req.query.latitude as string),
    long: parseFloat(req.query.longitude as string),
    destBuildingName: req.query.destination
};

  if (
    isNaN(request.lat) || isNaN(request.long) || 
    request.lat < -90 || request.lat > 90 || 
    request.long < -180 || request.long > 180 ||
    !request.destBuildingName || typeof request.destBuildingName !== 'string'
  ) {
    return;
  } 

  const dest = BUILDINGS.find(
    (building) => building.name.toLowerCase() === "northrop auditorium".toLowerCase()
  );

  if (!dest) {
    return
  }

  let nearestBuilding = null;
  let shortestDistance = Infinity;

  for (const node of BUILDINGS) {
    const geoDistanceToDestination = getDistance(request.lat, request.long, dest.lat, dest.long);
    const geoDistanceToNode = getDistance(request.lat, request.long, node.latitude, node.longitude);
    const nodeDistanceToDestination = getDistance(node.latitude, node.longitude, dest.lat, dest.long);

    // Skip buildings that are further from the destination
    if (nodeDistanceToDestination > geoDistanceToDestination) {
      continue;
    }
  
    if (geoDistanceToNode < shortestDistance) {
      shortestDistance = geoDistanceToNode;
      nearestBuilding = node;
    }
  }
  
  // Check if on same campus
  if (dest.campus != nearestBuilding.campus) {
    console.log("Nearest building not on same campus");
    return
  } else {
    console.log("Nearest building:", nearestBuilding.name);
  }
  res.json(nearestBuilding);
}

// gets top 5 popular routes
export function popularRoutes(req: Request, res: Response, next: NextFunction) {
  (async () => {

    let { records, summary } = await session.executeRead(
      async (tx: ManagedTransaction) => {
        return await tx.run(`
          MATCH (a)-[b:ROUTED_TO]->(c) 
          RETURN a.name AS start, c.name AS destination, b.visits AS visits, b.path AS path
          ORDER BY visits DESC
          LIMIT 5
        `)
      }
    )

    const routes: any = []

    for (const record of records) {
      const route: any = {}
      for (const field of record.keys)
        field == "visits" ? route[field] = record.get(field).low : route[field] = record.get(field)
        
      routes.push(route)
    }

    res.json({ routes: routes })
  })()
}

// could be improved with a fuzzy find or some sorting
export function searchBar(req: Request, res: Response) {
  (async () => {

    let input = req.query.input?.toString().toLowerCase();
    const matches = BUILDINGS.filter(building => building.name.toLowerCase().includes(input)).slice(0, 5)

    res.json(matches)
  })()
}

// returns Euclidien distance between two geopositions 
function getDistance(lat1: number, long1: number, lat2: number, long2: number){
  return Math.sqrt(Math.pow((lat2-lat1), 2) + Math.pow((long2-long1), 2));
}

// close database connection when app is exited
process.on("exit", async (code) => {
  try {
    await session.close();
	  await driver.close();
  } catch {
    console.log("Database connection failed to close");
  }
});
