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
            level: 'info',
            logger: (level, message) => console.log(`[Neo4j ${level}] ${message}`)
        }
    }
);

export async function verifyConnection(): Promise<void> {
    try {
        const serverInfo = await driver.getServerInfo();
        console.log('Connected to Neo4j:', serverInfo);
    } catch (err: any) {
        console.error('Failed to connect to Neo4j:', err);
        throw err; 
    }
}
