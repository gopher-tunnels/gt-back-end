import express from 'express';
import { buildingRouting, popularRoutes } from '../controller/routing.controller';

const router = express.Router();

router.get('/route?', buildingRouting);
router.get('/popular', popularRoutes);
router.post('/setroute')


export default router;