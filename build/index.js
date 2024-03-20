"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT;
const neo4j = require('neo4j-driver');

(async () => {
  require('dotenv').config({
    path: 'Neo4j-b04d4356-Created-2024-03-12.txt',
    debug: true  // to raise file/parsing errors
  })

  const URI = process.env.NEO4J_URI
  const USER = process.env.NEO4J_USERNAME
  const PASSWORD = process.env.NEO4J_PASSWORD

  let driver

  try {
    driver = neo4j.driver(URI,  neo4j.auth.basic(USER, PASSWORD))
    const serverInfo = await driver.getServerInfo()
    console.log('Connection estabilished')
    console.log(serverInfo)
  } catch(err) {
    console.log(`Connection error\n${err}\nCause: ${err.cause}`)
    await driver.close()
    return
  }

  let session = driver.session({ database: 'neo4j' });

  let { records, summary } = await session.executeRead(async tx => {
    return await tx.run(`
      MATCH (p:MAN)
      RETURN p.name, p.age
      `
    )
  })

//   console.log(records);

  for (let record in records) {
    // console.log(record.values())
    console.log(record)
//     let cat1 = record.get("p.name");
//     let cat2 = record.indexOf("p.age");

//     let name = record._fieldLookup[cat1];
//     let age = record._fieldLookup[cat2]

//     console.log(`Name: ${record._fields[name]}, Age: ${record._fields[age]}`);
  }

  console.log(records)

  await driver.close()
})();

app.get('/', (req, res) => {
    res.send('Gopher Tunnels back-end');
});
app.listen(port, () => {
    console.log(`App is listening on ${port}`);
});
