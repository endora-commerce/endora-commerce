import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { TaxService } from './services/tax-service.js';
import { registerTaxRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';

export interface TaxesModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 005 / T027b — when injected, new Taxes auto-bind to the system default. */
  salesChannelMembership?: SalesChannelMembershipService;
}

export interface TaxesModuleHandle {
  taxService: TaxService;
}

export function taxesModule(options: TaxesModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: TaxesModuleHandle;
} {
  const taxService = new TaxService(options.emFactory, options.salesChannelMembership);
  return {
    handle: { taxService },
    plugin: async (app: FastifyInstance) => {
      await registerTaxRoutes(app, { taxService, requireAdmin: options.requireAdmin });
    },
  };
}
