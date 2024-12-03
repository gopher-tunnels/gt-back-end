"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const routing_controller_1 = require("../controller/routing.controller");
const router = express_1.default.Router();
/**
 * @swagger
 * /route:
 *   get:
 *     summary: returns a route from a start location to a destination
 *     description: some description
*/
router.get('/route', routing_controller_1.buildingRouting);
/**
 * @swagger
 * /popular:
 *   get:
 *     summary: some summary
 *     description: some description
*/
router.get('/popular', routing_controller_1.popularRoutes);
/**
 * @swagger
 * /popular:
 *   get:
 *     summary: some summary
 *     description: some description
*/
router.get('/search', routing_controller_1.searchBar);
// TODO: needs to be implemented to support popularRoutes
// router.post('/setroute')
exports.default = router;
