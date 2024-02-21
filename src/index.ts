import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const port = process.env.PORT;

app.get('/', (req: Request, res: Response) => {
  res.send('Gopher Tunnels back-end');
});

app.listen(port, () => {
  console.log(`App is listening on ${port}`);
});
