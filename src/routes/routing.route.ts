import express from 'express';
import { getRoute, getPopularBuildings, searchBuildings, getAllBuildings } from '../controller/routing.controller';

const router = express.Router();

/**
 * @swagger
 * /route:
 *   get:
 *     summary: returns a route from a start location to a destination
 *     description: some description
*/
router.get('/route', getRoute);

/** 
 * @swagger
 * /popular:
 *   get:
 *     summary: some summary
 *     description: Returns the top 5 popular destinations from a single start location. Sorted by popularity. Highest is first
*/
router.get('/popular', getPopularBuildings);

/**
 * @swagger
 * /popular:
 *   get:
 *     summary: some summary
 *     description: some description
*/
router.get('/search', searchBuildings);

/**
 * @swagger
 * /buildings:
 *   get:
 *     summary: returns an array of all building nodes in neo4j.
 *     description: some description
*/
router.get('/buildings', getAllBuildings);

export default router;
