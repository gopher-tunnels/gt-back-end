import neo4j, { Driver } from "neo4j-driver";
import dotenv from 'dotenv';

dotenv.config();

const URI = process.env.NEO4J_URI;
const USER = process.env.NEO4J_USERNAME;
const PASSWORD = process.env.NEO4J_PASSWORD;

if (!URI || !USER || !PASSWORD) {
    throw new Error(".env missing fields");
}

export const driver: Driver = neo4j.driver(
    URI,
    neo4j.auth.basic(USER, PASSWORD),
    {
        logging: {
            level: 'warn',
            logger: (level, message) => console.log(`[Neo4j ${level}] ${message}`)
        }
    }
);

let neo4jAvailable = false;

export function isWriteAvailable(): boolean {
    return neo4jAvailable;
}

export async function verifyConnection(): Promise<boolean> {
    try {
        const serverInfo = await driver.getServerInfo();
        console.log('Connected to Neo4j:', serverInfo);
        neo4jAvailable = true;
        return true;
    } catch (err: unknown) {
        const error = err as Error;
        console.error(`\nCould not connect to Neo4j: ${error.message}`);
        neo4jAvailable = false;
        return false;
    }
}
