import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';

/**
 * Composition root for the settings module.
 *
 * Routes are added in feature 004 / US2 (T035–T036). The plugin exists from
 * Phase 2 onwards so `composition.ts` can wire the module while the rest of
 * the implementation lands incrementally.
 */

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface SettingsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  auditLogService?: AuditLogService;
  requireAdmin?: RequireAdminFactory;
  resolveAdminAuditContext?: (req: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
}

export function settingsModule(_options: SettingsModuleOptions) {
  return async function register(_app: FastifyInstance): Promise<void> {
    // Routes added in T035–T036.
  };
}
