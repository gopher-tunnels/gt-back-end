import express from 'express';
import { buildingRouting, popularRoutes, searchBar, geoPositionRoute } from '../controller/routing.controller';

const router = express.Router();

/** 
 * @swagger
 * /route:
 *   get:
 *     summary: returns a route from a start location to a destination
 *     description: some description
*/
router.get('/route', buildingRouting);
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
router.get('/geoposition', geoPositionRoute);

/** 
 * @swagger
 * /popular:
 *   get:
 *     summary: some summary
 *     description: some description
*/

router.get('/search', searchBar);

// TODO: needs to be implemented to support popularRoutes
// router.post('/setroute')

export default router;