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
    return `
        MATCH p=shortestPath((startNode:entrance|junction {name: ${start}})-[*]-(endNode:entrance|junction {name: ${destination}}))
        RETURN p
    `
};
