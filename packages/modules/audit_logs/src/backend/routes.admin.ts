import type { FastifyInstance } from 'fastify';
import type { AuditLogFacetsResponse, AuditReferenceLabel } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { AuditLogEntry } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { decodeAuditLogCursor, encodeAuditLogCursor } from './audit-log-cursor.js';

/**
 * Admin Audit Log query route (T195 / FR-084).
 *
 * Always reads — never mutates — the append-only audit log. Filters are
 * accepted as query params (`filter[actor]`, `filter[action]`, …); a
 * default `limit=100` keeps the page lightweight, capped at
 * {@link AUDIT_LOG_MAX_LIMIT}.
 *
 * The list pages by cursor (issue #1555): while more entries exist the answer
 * carries `pagination.cursor`, and `?cursor=` reads the page after it. It used
 * to answer `hasMore: false` always, so the screen showed the newest page and
 * nothing behind it.
 */

/**
 * The largest page. One entry past the page is read to know whether another
 * page exists, and the platform's read caps at 500, so a page stays under it.
 */
export const AUDIT_LOG_MAX_LIMIT = 200;
const AUDIT_LOG_DEFAULT_LIMIT = 100;

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
  /**
   * Names the customer who acted for themselves (issue #741) — the
   * `customer_account` audit reference, the same lookup the dashboard card
   * names an impersonated customer with. Optional, and an id it has no label
   * for is simply absent: the viewer falls back to the raw id.
   */
  resolveCustomers?: (ids: string[]) => Promise<ReadonlyMap<string, AuditReferenceLabel>>;
}

export async function registerAuditLogAdminRoutes(
  app: FastifyInstance,
  deps: AuditLogAdminDeps,
): Promise<void> {
  const { auditLogService, requireAdmin, resolveActors, resolveCustomers } = deps;

  app.get(
    '/api/v1/admin/audit-log',
    { preHandler: requireAdmin('audit_log:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const limitNum = q['limit'] ? Number.parseInt(q['limit'], 10) : undefined;
      const limit = Math.min(
        Math.max(limitNum !== undefined && Number.isFinite(limitNum) ? limitNum : AUDIT_LOG_DEFAULT_LIMIT, 1),
        AUDIT_LOG_MAX_LIMIT,
      );
      const after = q['cursor'] ? decodeAuditLogCursor(q['cursor']) : undefined;
      const read = await auditLogService.query({
        ...(q['filter[actor]'] ? { actorAdminUserId: q['filter[actor]']! } : {}),
        ...(q['filter[customer]']
          ? { impersonatedCustomerAccountId: q['filter[customer]']! }
          : {}),
        ...(q['filter[action]'] ? { action: q['filter[action]']! } : {}),
        ...(q['filter[objectType]'] ? { objectType: q['filter[objectType]']! } : {}),
        ...(q['filter[objectId]'] ? { objectId: q['filter[objectId]']! } : {}),
        ...(after ? { after } : {}),
        limit: limit + 1,
      });
      const hasMore = read.length > limit;
      const entries = hasMore ? read.slice(0, limit) : read;
      const last = entries[entries.length - 1];
      // Enrich the actor column with name + email (one batched lookup).
      const actorIds = entries
        .map((e) => e.actorAdminUserId)
        .filter((id): id is string => Boolean(id));
      const customerIds = [
        ...new Set(
          entries
            .map((e) => e.actorCustomerAccountId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const [actors, customers] = await Promise.all([
        resolveActors ? resolveActors(actorIds) : Promise.resolve([]),
        resolveCustomers && customerIds.length > 0
          ? resolveCustomers(customerIds)
          : Promise.resolve(new Map<string, AuditReferenceLabel>()),
      ]);
      const actorById = new Map(actors.map((a) => [a.id, a]));
      return {
        data: entries.map((e) => serialize(e, actorById, customers)),
        pagination: {
          cursor: hasMore && last ? encodeAuditLogCursor({ actedAt: last.actedAt, id: last.id }) : null,
          hasMore,
          limit,
        },
      };
    },
  );

  // What the viewer's filters offer (issue #1555): the actions the log holds,
  // each with the module whose bundle labels it, and the object types.
  app.get(
    '/api/v1/admin/audit-log/facets',
    { preHandler: requireAdmin('audit_log:read') },
    async (): Promise<{ data: AuditLogFacetsResponse }> => {
      const facets = await auditLogService.queryFacets();
      return {
        data: {
          actions: facets.actions.map((action) => ({ action, moduleId: moduleIdForAuditAction(action) })),
          objectTypes: facets.objectTypes,
        },
      };
    },
  );
}

function serialize(
  e: AuditLogEntry,
  actorById: Map<string, AuditActorIdentity>,
  customers: ReadonlyMap<string, AuditReferenceLabel>,
) {
  const actor = e.actorAdminUserId ? actorById.get(e.actorAdminUserId) : undefined;
  const actorCustomerAccountId = e.actorCustomerAccountId ?? null;
  return {
    id: e.id,
    actorAdminUserId: e.actorAdminUserId ?? null,
    actorName: actor ? `${actor.firstName} ${actor.lastName}`.trim() : null,
    actorEmail: actor?.email ?? null,
    impersonatedCustomerAccountId: e.impersonatedCustomerAccountId ?? null,
    actorCustomerAccountId,
    actorCustomerLabel: actorCustomerAccountId
      ? (customers.get(actorCustomerAccountId)?.label ?? null)
      : null,
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

/**
 * Which module's bundle labels an action (`auditLog.<action>`). Exported for
 * its test.
 */
export function moduleIdForAuditAction(action: string): string {
  // The escape-hatch rows (owner decision of 2026-10-03): written by the
  // platform for every cross-organization access, labelled here, because the
  // audit log is where an operator reads them.
  if (action.startsWith('tenant.')) return 'audit_logs';
  // Issue #844 — the row the platform writes when it erases an anonymised
  // subject's history; labelled here for the same reason.
  if (action.startsWith('audit.')) return 'audit_logs';
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
  if (action.startsWith('crm.')) return 'crm';
  return 'core';
}
