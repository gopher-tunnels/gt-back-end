export function getAllMajor() { 
    return `
        MATCH (t)
        WHERE ((t:junction) OR (t:entrance))
        RETURN t AS start, 
        COLLECT {
            MATCH (t)-[:CONNECTED_TO]->(v)
            WHERE ((v:junction) OR (v:entrance))
            RETURN v
        } AS destinations
    `
};

export function getPath(start: string, destination: string) {
    return `MATCH p=shortestPath(
            (startNode:entrance|junction {name: \"${start}\"})-[*]-(endNode:entrance|junction {name: \"${destination}\"})) 
            RETURN p`
};

export function searchName(query: string) {
    return `
        MATCH (n:entrance|junction)
        WHERE n.name STARTS WITH ${query}
        RETURN n
    `
};

export function djykstraPath(start: string, destination: string){
    return `
        match (a:entrance) where a.name = "TateNW"
        match (b:entrance) where b.name = "VincentNE"
        call apoc.algo.dijkstra(a,b,'CONNECTED_TO','distanceMeters') yield path, weight
        return path
    `
};
