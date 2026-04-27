import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { TaxService } from './services/tax-service.js';
import { registerTaxRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface TaxesModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export interface TaxesModuleHandle {
  taxService: TaxService;
}

export function taxesModule(options: TaxesModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: TaxesModuleHandle;
} {
  const taxService = new TaxService(options.emFactory);
  return {
    handle: { taxService },
    plugin: async (app: FastifyInstance) => {
      await registerTaxRoutes(app, { taxService, requireAdmin: options.requireAdmin });
    },
  };
}
