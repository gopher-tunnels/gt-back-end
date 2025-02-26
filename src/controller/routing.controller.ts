import { Request, Response, NextFunction } from 'express';
import { ManagedTransaction, Session } from 'neo4j-driver-core';
import dotenv from 'dotenv';
import { findDir } from './utils/directions'

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
type Node = {
  name: string,
  id: number,
  kind: "start" | "tunnel" | "target",
  latitude: number,
  longitude: number,
}

type Path = {
  from: number,
  to: number,
  attributes: string[]
}
const coor=[[44.976606975468776, -93.23536993145039],[44.97595595602177, -93.2365941832571],
[44.975340765715636, -93.23607071007078],[44.974594166673526, -93.23630711731622],
[44.9740327177907, -93.23625645862076],[44.97405063645697, -93.23451717674367],
[44.97464792212929, -93.23423011080278],[44.97535868397321, -93.23455094920729],
[44.975872338309486, -93.23452561985957]]

const ns: Node[]=[
  {name:"Northrop",id: 1, kind: "start", latitude: coor[0][0], longitude: coor[0][1]},
  {name:"Johnston Hall", id: 2, kind: "tunnel", latitude: coor[1][0], longitude: coor[1][1]},
  {name:"Walter Library",id: 3, kind: "tunnel", latitude: coor[2][0], longitude: coor[2][1]},
  {name:"Smith Hall",id: 4, kind: "tunnel", latitude: coor[3][0], longitude: coor[3][1]},
  {name:"Kolthoff Hall",id: 5, kind: "tunnel", latitude: coor[4][0], longitude: coor[4][1]},
  {name:"Ford Hall",id: 6, kind: "tunnel", latitude: coor[5][0], longitude: coor[5][1]}, 
  {name:"Murphy Hall",id: 7, kind: "tunnel", latitude: coor[6][0], longitude: coor[6][1]},
  {name:"John T. Tate Hall",id: 8, kind: "tunnel", latitude: coor[7][0], longitude: coor[7][1]},
  {name:"Morrill Hall",id: 9, kind: "target", latitude: coor[8][0], longitude: coor[8][1]}
]
type Query = {
  startLat: number,
  startLong: number,
  target: string,
}

export function getRoutes(req: Request, res: Response, next: NextFunction) {
  const visited=new Set<number>();
  const nodes:Node[]=[];
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
  const start:Node={name:"start",id:66,kind:"start",latitude:startLat,longitude:startLong};
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
    const start = req.query.start
    const destination = req.query.destination

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

    for (let record of records) {
      const path = record.get('p').segments;
      if (path.length === 0) continue; // if no segments, skip

      // processing each segment in the path
      for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        const nodePrev = segment.start;
        const node = segment.end;
        const nodeNext = i < path.length - 1 ? path[i + 1].end : null;
        // if start node, default to "straight"
        if (i == 0) {
          route.push({
            name: nodePrev.properties.name,
            location: {
              latitude: nodePrev.properties.latitude,
              longitude: nodePrev.properties.longitude,
            },
            direction: "straight"
          });
        } else {
          // add the current node
          route.push({
            name: node.properties.name,
            location: {
              latitude: node.properties.latitude,
              longitude: node.properties.longitude,
            },
            direction: nodeNext ? findDir(nodePrev, node, nodeNext) : ""
          });
        }

        // if this is the last segment, add the final node with no direction
        if (i === path.length - 1 && nodeNext) {
          route.push({
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
    
      // Retrieve and log the visits count (NOT NEEDED, FOR VERIFICATION)
      if (result.records.length > 0) {
        const visits = result.records[0].get('visits');
        console.log(`ROUTED_TO connection exists with visits: ${visits}`);
      } else {
        console.log("Failed to retrieve the visits count.");
      }
    } catch (error) {
      console.error("Error creating or updating ROUTED_TO relationship:", error);
    }
    
    res.json(route);
  })()
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

// close database connection when app is exited
process.on("exit", async (code) => {
  try {
    await session.close();
	  await driver.close();
  } catch {
    console.log("Database connection failed to close");
  }
});
