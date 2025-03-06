import neo4j, { Driver } from "neo4j-driver";
import dotenv from 'dotenv';

dotenv.config();
const URI = process.env.NEO4J_URI;
const USER = process.env.NEO4J_USERNAME;
const PASSWORD = process.env.NEO4J_PASSWORD;

export let driver: Driver | undefined;

(async () => {
    try {
        if (!URI || !USER || !PASSWORD) {
            throw new Error("env missing fields");
        }
        driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
        const serverInfo = await driver.getServerInfo()
        console.log('Database connection estabilished')
        console.log(serverInfo)
    } catch(err: any) {
        console.log(`Could not connect to db, continuing without connection\n${err}\nCause: ${err.cause}`);
    }
})();
