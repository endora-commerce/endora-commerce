import type { FastifyInstance } from 'fastify';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { AuditLogEntry } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin Audit Log query route (T195 / FR-084).
 *
 * Always reads — never mutates — the append-only audit log. Filters are
 * accepted as query params (`filter[actor]`, `filter[action]`, …); a
 * default `limit=100` keeps the page lightweight, capped at 500.
 */

/** Minimal actor identity used to enrich the audit-log actor column. */
export interface AuditActorIdentity {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface AuditLogAdminDeps {
  auditLogService: AuditPort;
  requireAdmin: RequireAdminFactory;
  /**
   * Resolves admin-user identities for the actor column (name + email instead
   * of a bare id). Unknown ids may be omitted. Optional — when absent the
   * column falls back to the raw id.
   */
  resolveActors?: (ids: string[]) => Promise<AuditActorIdentity[]>;
}

export async function registerAuditLogAdminRoutes(
  app: FastifyInstance,
  deps: AuditLogAdminDeps,
): Promise<void> {
  const { auditLogService, requireAdmin, resolveActors } = deps;

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
      // Enrich the actor column with name + email (one batched lookup).
      const actorIds = entries
        .map((e) => e.actorAdminUserId)
        .filter((id): id is string => Boolean(id));
      const actors = resolveActors ? await resolveActors(actorIds) : [];
      const actorById = new Map(actors.map((a) => [a.id, a]));
      return {
        data: entries.map((e) => serialize(e, actorById)),
        pagination: { cursor: null, hasMore: false, limit: entries.length },
      };
    },
  );
}

function serialize(e: AuditLogEntry, actorById: Map<string, AuditActorIdentity>) {
  const actor = e.actorAdminUserId ? actorById.get(e.actorAdminUserId) : undefined;
  return {
    id: e.id,
    actorAdminUserId: e.actorAdminUserId ?? null,
    actorName: actor ? `${actor.firstName} ${actor.lastName}`.trim() : null,
    actorEmail: actor?.email ?? null,
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
