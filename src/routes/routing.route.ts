import express from 'express';


import { buildingRouting, popularRoutes, searchBar, userLocationRoute, getBuildings,getRoutes } from '../controller/routing.controller';


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

router.get('/routes', getRoutes);
/** 
 * @swagger
 * /popular:
 *   get:
 *     summary: some summary
 *     description: some description
*/

router.get('/userlocation', userLocationRoute);

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
 *     summary: some summary
 *     description: some description
*/
router.get('/buildings', getBuildings);

export default router;