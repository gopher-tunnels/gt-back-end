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
        WHERE n.name STARTS WITH "${query.toLowerCase()}"
        RETURN n 
        LIMIT 5`
};

export function getPopular() {
    return `
        MATCH (a)-[b:ROUTED_TO]->(c) 
        RETURN a.name AS start, c.name AS destination, b.visits AS visits, b.path AS path
        ORDER BY visits DESC
        LIMIT 5`
}
