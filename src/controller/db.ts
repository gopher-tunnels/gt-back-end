import neo4j, { Driver } from "neo4j-driver";
import dotenv from 'dotenv';
import { setNeo4jAvailable } from '../services/connectionState';

dotenv.config();

const URI = process.env.NEO4J_URI;
const USER = process.env.NEO4J_USERNAME;
const PASSWORD = process.env.NEO4J_PASSWORD;

if (!URI || !USER || !PASSWORD) {
    throw new Error(".env missing fields");
}

// ASSUMING DRIVER ALWAYS EXISTS, FOR DEVELOPMENT
// In production, if driver fails frontend should go to backup data or not start at all.
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

/**
 * Verifies the Neo4j connection and updates the connection state.
 * @returns true if connection succeeded, false otherwise
 */
export async function verifyConnection(): Promise<boolean> {
    try {
        const serverInfo = await driver.getServerInfo();
        console.log('Connected to Neo4j:', serverInfo);
        setNeo4jAvailable(true);
        return true;
    } catch (err: unknown) {
        const error = err as Error;
        console.error(`\nCould not connect to Neo4j: ${error.message}`);
        setNeo4jAvailable(false);
        return false;
    }
}
