import type { FastifyInstance } from 'fastify';
import type { AuditLogService } from './services/audit-log-service.js';
import type { AuditLogEntry } from './entities/audit-log-entry.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Admin Audit Log query route (T195 / FR-084).
 *
 * Always reads — never mutates — the append-only audit log. Filters are
 * accepted as query params (`filter[actor]`, `filter[action]`, …); a
 * default `limit=100` keeps the page lightweight, capped at 500.
 */

export interface AuditLogAdminDeps {
  auditLogService: AuditLogService;
  requireAdmin: RequireAdminFactory;
}

export async function registerAuditLogAdminRoutes(
  app: FastifyInstance,
  deps: AuditLogAdminDeps,
): Promise<void> {
  const { auditLogService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/audit-log',
    { preHandler: requireAdmin('audit_log:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const limitNum = q['limit'] ? Number.parseInt(q['limit'], 10) : undefined;
      const entries = await auditLogService.query({
        ...(q['filter[actor]'] ? { actorAdminUserId: q['filter[actor]']! } : {}),
        ...(q['filter[customer]']
          ? { impersonatedCustomerAccountId: q['filter[customer]']! }
          : {}),
        ...(q['filter[action]'] ? { action: q['filter[action]']! } : {}),
        ...(q['filter[objectType]'] ? { objectType: q['filter[objectType]']! } : {}),
        ...(q['filter[objectId]'] ? { objectId: q['filter[objectId]']! } : {}),
        ...(limitNum !== undefined && Number.isFinite(limitNum) ? { limit: limitNum } : {}),
      });
      return {
        data: entries.map(serialize),
        pagination: { cursor: null, hasMore: false, limit: entries.length },
      };
    },
  );
}

function serialize(e: AuditLogEntry) {
  return {
    id: e.id,
    actorAdminUserId: e.actorAdminUserId ?? null,
    impersonatedCustomerAccountId: e.impersonatedCustomerAccountId ?? null,
    actedAt: e.actedAt.toISOString(),
    action: e.action,
    actionModuleId: moduleIdForAuditAction(e.action),
    objectType: e.objectType,
    objectId: e.objectId,
    stateBefore: e.stateBefore ?? null,
    stateAfter: e.stateAfter ?? null,
    ipAddress: e.ipAddress ?? null,
    userAgent: e.userAgent ?? null,
    requestId: e.requestId ?? null,
  };
}

function moduleIdForAuditAction(action: string): string {
  if (action.startsWith('setting.')) return 'settings';
  if (action.startsWith('setting_group.')) return 'settings';
  if (action.startsWith('module.')) return 'core';
  if (action.startsWith('product.')) return 'catalog';
  if (action.startsWith('attribute_set.')) return 'catalog';
  if (action.startsWith('gallery.')) return 'catalog';
  if (action.startsWith('attachment.')) return 'catalog';
  if (action.startsWith('attachment_type.')) return 'catalog';
  if (action.startsWith('product_link.')) return 'catalog';
  if (action.startsWith('grouped_item.')) return 'catalog';
  if (action.startsWith('bundle_slot.')) return 'catalog';
  if (action.startsWith('bundle_slot_option.')) return 'catalog';
  if (action.startsWith('sales_channel.')) return 'sales_channels';
  if (action.startsWith('api_key.')) return 'core';
  if (action.startsWith('impersonation.')) return 'core';
  if (action.startsWith('order.')) return 'core';
  if (action.startsWith('organization.')) return 'core';
  return 'core';
}
