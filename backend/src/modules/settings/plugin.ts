import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { SettingsAdminService, type AdminAuditContext } from './services/settings-admin.service.js';
import { registerSettingsAdminRoutes } from './routes.admin.js';

/**
 * Composition root for the settings module — feature 004.
 *
 * Today exposes the admin HTTP surface (US2). The boot-time manifest
 * reconciler runs from `composition.ts` directly (T024).
 */

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface SettingsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  auditLogService?: AuditLogService;
  requireAdmin?: RequireAdminFactory;
  resolveAdminAuditContext?: (req: FastifyRequest) => AdminAuditContext;
}

export interface SettingsModuleHandle {
  adminService: SettingsAdminService;
}

export interface SettingsModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: SettingsModuleHandle;
}

export function settingsModule(
  options: SettingsModuleOptions,
): SettingsModuleResult {
  const adminService = new SettingsAdminService(
    options.emFactory,
    options.eventBus,
    options.auditLogService,
  );

  const noOpRequireAdmin: RequireAdminFactory =
    () => async (_req, _reply) => {
      /* permissive default — production wiring overrides */
    };

  return {
    handle: { adminService },
    plugin: async (app) => {
      const requireAdminFn = options.requireAdmin ?? noOpRequireAdmin;
      await registerSettingsAdminRoutes(app, {
        adminService,
        requireAdmin: requireAdminFn,
        ...(options.resolveAdminAuditContext !== undefined
          ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
          : {}),
      });
    },
  };
}
