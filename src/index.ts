import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { Driver, ManagedTransaction, TransactionPromise } from 'neo4j-driver-core';

dotenv.config();

const app: Express = express();
const port = process.env.PORT;
const neo4j = require('neo4j-driver');
let driver

(async () => {
  require('dotenv').config({
    path: 'Neo4j-b04d4356-Created-2024-03-12.txt',
    debug: true  // to raise file/parsing errors
  })

  const URI = process.env.NEO4J_URI
  const USER = process.env.NEO4J_USERNAME
  const PASSWORD = process.env.NEO4J_PASSWORD

  // debugging and connecting
  try {
    driver = neo4j.driver(URI,  neo4j.auth.basic(USER, PASSWORD))
    const serverInfo = await driver.getServerInfo()
    console.log('Connection estabilished')
    console.log(serverInfo)
  } catch(err: any) {
    console.log(`Connection error\n${err}\nCause: ${err.cause}`)
    await driver.close()
  }

  // below is example query

  let session = driver.session({ database: 'neo4j' });

  let { records, summary } = await session.executeRead(
    async (tx: ManagedTransaction) => {
    return await tx.run(`
      MATCH (p)
      RETURN p
      `
    )
  })

  console.log(records, summary)

  await driver.close()
})();

app.get('/', (req: Request, res: Response) => {
  res.send('Gopher Tunnels back-end');
});

process.on('exit', async () => {
  // try {
  //   await driver.close()
  // } catch (err: any) {
  //   console.log(`Error ${err}: ${err.cause}`)
  // }
  console.log("Program Exited")
  return
});

app.listen(port, () => {
  console.log(`App is listening on ${port}`);
});
