import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { TaxService } from './services/tax-service.js';
import { registerTaxRoutes } from './routes.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import type { DictionaryValidator } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface TaxesModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 005 / T027b — when injected, new Taxes auto-bind to the system default. */
  salesChannelMembership?: SalesChannelMembershipService;
  dictionaryValidator?: DictionaryValidator;
  /** Feature 054 — audits tax writes co-transactionally when provided. */
  auditLog?: AuditLogService;
}

export interface TaxesModuleHandle {
  taxService: TaxService;
}

export function taxesModule(options: TaxesModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: TaxesModuleHandle;
} {
  const taxService = new TaxService(
    options.emFactory,
    options.salesChannelMembership,
    options.dictionaryValidator,
    options.auditLog,
  );
  return {
    handle: { taxService },
    plugin: async (app: FastifyInstance) => {
      await registerTaxRoutes(app, { taxService, requireAdmin: options.requireAdmin });
    },
  };
}
