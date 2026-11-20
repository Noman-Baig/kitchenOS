import { Router } from 'express';
import { requireAuth, requireTenant } from '../../middleware/auth.js';
import { coreRouter } from './core.js';
import { menuRouter } from './menu.js';
import { opsRouter } from './operations.js';
import { backofficeRouter } from './backoffice.js';
import { reportsRouter } from './reports.js';

/** All restaurant-staff endpoints. Tenant = req.user.restaurantId (server-side session), never client input. */
export const restaurantRouter = Router();
restaurantRouter.use(requireAuth, requireTenant);
restaurantRouter.use(coreRouter);
restaurantRouter.use(menuRouter);
restaurantRouter.use(opsRouter);
restaurantRouter.use(backofficeRouter);
restaurantRouter.use(reportsRouter);
