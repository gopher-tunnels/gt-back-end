import express from 'express';
import { route, popularRoutes, searchBar, buildings } from '../controller/routing.controller';

const router = express.Router();

/** 
 * @swagger
 * /route:
 *   get:
 *     summary: returns a route from a start location to a destination
 *     description: some description
*/
router.get('/route', route);
/** 
 * @swagger
 * /popular:
 *   get:
 *     summary: some summary
 *     description: some description
*/
router.get('/popular', popularRoutes);

/** 
 * @swagger
 * /popular:
 *   get:
 *     summary: some summary
 *     description: some description
*/

router.get('/search', searchBar);

/** 
 * @swagger
 * /buildings:
 *   get:
 *     summary: returns an array of all building nodes in neo4j.
 *     description: some description
*/
router.get('/buildings', buildings);

export default router;