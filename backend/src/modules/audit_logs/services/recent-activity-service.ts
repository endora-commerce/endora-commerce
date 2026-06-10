import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogEntry } from '../entities/audit-log-entry.entity.js';
import {
  RECENT_ACTIVITY_ACTIONS,
  moduleForAction,
  type RecentActivityAction,
  type RecentActivityModule,
} from '../action-catalog.js';

/**
 * Feature 024 — Dashboard "Recent Activity" read service.
 *
 * Curated read view over `audit_log_entries` that powers the admin home
 * dashboard's Recent Activity card. Server-enforced allowlist of action
 * tokens; bulk-resolves actor + target display labels in at most a small
 * fixed number of round-trips (one per object-type bucket); composes
 * deep-link URLs from a single in-file template map.
 */

export interface RecentActivityItem {
  id: string;
  actedAt: string;
  action: RecentActivityAction;
  module: RecentActivityModule;
  actorDisplayName: string;
  actorKind: 'admin' | 'system';
  targetType: string;
  targetId: string;
  targetDisplayName: string;
  targetUrl: string | null;
  summary: Record<string, unknown> | null;
}

export interface RecentActivityResponse {
  data: RecentActivityItem[];
  pagination: { limit: number; fetchedAt: string };
}

export interface ListRecentActivityInput {
  /** Caller-supplied limit. Clamped to [1, 12] server-side. Defaults to 8. */
  limit?: number;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;

export class RecentActivityService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(input: ListRecentActivityInput = {}): Promise<RecentActivityResponse> {
    const limit = clampLimit(input.limit);

    const em = this.emFactory();

    // The existing `actedAt DESC` index handles the sort; the secondary `id DESC`
    // tiebreak (research §R2) gives the dashboard deterministic ordering when
    // two admins act inside the same second. Row count is bounded by `limit`,
    // so the extra sort key has negligible cost at our volumes.
    const rows = await em.find(
      AuditLogEntry,
      { action: { $in: RECENT_ACTIVITY_ACTIONS as unknown as string[] } },
      {
        orderBy: { actedAt: 'desc', id: 'desc' },
        limit,
      },
    );

    const enriched = await this.enrich(em, rows);

    return {
      data: enriched,
      pagination: { limit, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * Bulk-resolve actor + target labels for the given rows in at most one
   * SQL round-trip per object-type bucket. Never N+1.
   */
  private async enrich(
    em: EntityManager,
    rows: AuditLogEntry[],
  ): Promise<RecentActivityItem[]> {
    if (rows.length === 0) return [];

    // --- Actor labels (admin_users) ---
    const adminIds = uniqueNonNull(rows.map((r) => r.actorAdminUserId ?? null));
    const adminNames = adminIds.length > 0 ? await loadAdminNames(em, adminIds) : new Map();

    // --- Impersonated customer labels (customer_accounts -> email or name) ---
    const customerIds = uniqueNonNull(
      rows.map((r) => r.impersonatedCustomerAccountId ?? null),
    );
    const customerNames =
      customerIds.length > 0 ? await loadCustomerNames(em, customerIds) : new Map();

    // --- Target labels: bucket by objectType to do one SQL per bucket. ---
    const productIds = uniqueByType(rows, 'product');
    const warehouseIds = uniqueByType(rows, 'warehouse');
    const priceListIds = uniqueByType(rows, 'price_list');

    const productNames = productIds.length > 0 ? await loadProductNames(em, productIds) : new Map();
    const warehouseNames =
      warehouseIds.length > 0 ? await loadWarehouseNames(em, warehouseIds) : new Map();
    const priceListNames =
      priceListIds.length > 0 ? await loadPriceListNames(em, priceListIds) : new Map();

    return rows.map((r) => buildItem(r, {
      adminNames,
      customerNames,
      productNames,
      warehouseNames,
      priceListNames,
    }));
  }
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  const n = Math.floor(value);
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

function uniqueNonNull<T>(arr: Array<T | null | undefined>): T[] {
  const set = new Set<T>();
  for (const v of arr) if (v !== null && v !== undefined) set.add(v);
  return [...set];
}

function uniqueByType(rows: AuditLogEntry[], objectType: string): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.objectType === objectType && r.objectId) set.add(r.objectId);
  return [...set];
}

interface Lookups {
  adminNames: Map<string, string>;
  customerNames: Map<string, string>;
  productNames: Map<string, { name: string; sku: string }>;
  warehouseNames: Map<string, { name: string; code: string }>;
  priceListNames: Map<string, { name: string; code: string }>;
}

function buildItem(r: AuditLogEntry, lookups: Lookups): RecentActivityItem {
  const action = r.action as RecentActivityAction;
  const module = moduleForAction(action);

  // --- Actor ---
  const actorKind: 'admin' | 'system' = r.actorAdminUserId ? 'admin' : 'system';
  let actorDisplayName: string;
  if (r.actorAdminUserId) {
    actorDisplayName = lookups.adminNames.get(r.actorAdminUserId) ?? 'Admin';
  } else {
    actorDisplayName = 'System';
  }
  if (r.impersonatedCustomerAccountId) {
    const customerLabel =
      lookups.customerNames.get(r.impersonatedCustomerAccountId) ?? r.impersonatedCustomerAccountId;
    actorDisplayName = `${actorDisplayName} (as ${customerLabel})`;
  }

  // --- Target display + URL ---
  const { targetDisplayName, targetUrl } = resolveTarget(r, lookups);

  return {
    id: r.id,
    actedAt: r.actedAt.toISOString(),
    action,
    module,
    actorDisplayName,
    actorKind,
    targetType: r.objectType,
    targetId: r.objectId,
    targetDisplayName,
    targetUrl,
    summary: extractSummary(r),
  };
}

function resolveTarget(
  r: AuditLogEntry,
  lookups: Lookups,
): { targetDisplayName: string; targetUrl: string | null } {
  const before = (r.stateBefore ?? null) as Record<string, unknown> | null;
  const after = (r.stateAfter ?? null) as Record<string, unknown> | null;

  switch (r.objectType) {
    case 'product': {
      const fromSnapshot = pickProductLabel(after) ?? pickProductLabel(before);
      const live = lookups.productNames.get(r.objectId);
      const name = fromSnapshot ?? (live ? live.name || live.sku : null);
      const sku = live?.sku ?? null;
      const display = name ?? sku ?? r.objectId;
      const url = live ? `/catalog/products/${r.objectId}` : null;
      return { targetDisplayName: display, targetUrl: url };
    }
    case 'warehouse': {
      const live = lookups.warehouseNames.get(r.objectId);
      const fromSnapshot = pickStr(after, 'name') ?? pickStr(before, 'name');
      const fromSnapshotCode = pickStr(after, 'code') ?? pickStr(before, 'code');
      const name = fromSnapshot ?? live?.name ?? null;
      const code = fromSnapshotCode ?? live?.code ?? null;
      const display = name ?? code ?? r.objectId;
      const url = live ? `/warehouses/${r.objectId}` : null;
      return { targetDisplayName: display, targetUrl: url };
    }
    case 'price_list': {
      const live = lookups.priceListNames.get(r.objectId);
      const fromSnapshot = pickStr(after, 'name') ?? pickStr(before, 'name');
      const fromSnapshotCode = pickStr(after, 'code') ?? pickStr(before, 'code');
      const display = fromSnapshot ?? live?.name ?? fromSnapshotCode ?? live?.code ?? r.objectId;
      const url = live ? `/price-lists/${r.objectId}` : null;
      return { targetDisplayName: display, targetUrl: url };
    }
    case 'stock_level': {
      // Composite id "<productId>:<warehouseId>"; snapshot carries the
      // human-readable parts.
      const productSku = pickStr(after, 'productSku') ?? pickStr(before, 'productSku');
      const warehouseCode = pickStr(after, 'warehouseCode') ?? pickStr(before, 'warehouseCode');
      const display =
        productSku && warehouseCode
          ? `${productSku} @ ${warehouseCode}`
          : productSku ?? warehouseCode ?? r.objectId;
      const productId = pickStr(after, 'productId') ?? pickStr(before, 'productId');
      const url = productId ? `/catalog/products/${productId}` : null;
      return { targetDisplayName: display, targetUrl: url };
    }
    case 'low_stock_threshold': {
      const display = pickStr(after, 'productSku') ?? pickStr(before, 'productSku') ?? 'threshold';
      const productId = pickStr(after, 'productId') ?? pickStr(before, 'productId');
      const url = productId ? `/catalog/products/${productId}` : '/inventory/low-stock';
      return { targetDisplayName: display, targetUrl: url };
    }
    case 'prompt_action_request': {
      // Feature 043 — prompt-assistant execution summary. The snapshot
      // carries the original prompt; surface a trimmed form of it.
      const prompt = pickStr(after, 'prompt');
      const display = prompt
        ? prompt.length > 80
          ? `${prompt.slice(0, 77)}…`
          : prompt
        : 'prompt action';
      // No standalone detail page in v1 — outcomes live in the palette.
      return { targetDisplayName: display, targetUrl: null };
    }
    case 'bulk_operation': {
      const fileName = pickStr(after, 'fileName');
      const warehouseCode =
        pickStr(after, 'warehouseCode') ?? pickStr(before, 'warehouseCode');
      const display =
        fileName && warehouseCode
          ? `${fileName} → ${warehouseCode}`
          : fileName ?? (r.action === 'product.bulk_update' ? 'bulk product update' : r.objectId);
      // Bulk operations don't have a single canonical detail page in v1.
      return { targetDisplayName: display, targetUrl: null };
    }
    default:
      return { targetDisplayName: r.objectId, targetUrl: null };
  }
}

function pickProductLabel(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) return null;
  const name = snapshot['name'];
  if (typeof name === 'string' && name.length > 0) return name;
  if (name && typeof name === 'object') {
    const byLang = name as Record<string, unknown>;
    // Try common language fallbacks before iterating.
    for (const key of ['en', 'en-US', 'pl', 'pl-PL']) {
      const v = byLang[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    for (const v of Object.values(byLang)) {
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  const sku = snapshot['sku'];
  if (typeof sku === 'string' && sku.length > 0) return sku;
  return null;
}

function pickStr(snapshot: Record<string, unknown> | null, key: string): string | null {
  if (!snapshot) return null;
  const v = snapshot[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function extractSummary(r: AuditLogEntry): Record<string, unknown> | null {
  // Surface only a compact summary for bulk-style rows. Never the full
  // stateBefore/stateAfter blobs (FR-030).
  const after = r.stateAfter as Record<string, unknown> | null | undefined;
  if (!after) return null;
  if (r.objectType !== 'bulk_operation' && r.action !== 'price_list.products_replace') {
    return null;
  }
  const keys = [
    'fileName',
    'warehouseId',
    'warehouseCode',
    'rowsProcessed',
    'rowsSkipped',
    'rowsErrored',
    'added',
    'removed',
    'kept',
    'touchedFields',
  ] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in after) out[k] = (after as Record<string, unknown>)[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ---------- Bulk loaders (plain SQL — keeps audit_logs out of other modules' internals) ----------

async function loadAdminNames(em: EntityManager, ids: string[]): Promise<Map<string, string>> {
  const rows = (await em.getConnection().execute(
    'select id::text as id, first_name, last_name from admin_users where id in (?)',
    [ids],
  )) as Array<{ id: string; first_name: string | null; last_name: string | null }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    const first = (r.first_name ?? '').trim();
    const last = (r.last_name ?? '').trim();
    const initial = last.length > 0 ? `${last.slice(0, 1)}.` : '';
    const display = [first, initial].filter((s) => s.length > 0).join(' ').trim() || r.id;
    map.set(r.id, display);
  }
  return map;
}

async function loadCustomerNames(em: EntityManager, ids: string[]): Promise<Map<string, string>> {
  // Customer accounts: prefer organization name (joined) over the account email.
  // Keep the query minimal — one LEFT JOIN, no per-row work.
  const rows = (await em.getConnection().execute(
    `select ca.id::text as id, ca.email, o.name as organization_name
     from customer_accounts ca
     left join organizations o on o.id = ca.organization_id
     where ca.id in (?)`,
    [ids],
  )) as Array<{ id: string; email: string | null; organization_name: string | null }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.id, r.organization_name ?? r.email ?? r.id);
  }
  return map;
}

async function loadProductNames(
  em: EntityManager,
  ids: string[],
): Promise<Map<string, { name: string; sku: string }>> {
  const rows = (await em.getConnection().execute(
    'select id::text as id, sku, name from products where id in (?)',
    [ids],
  )) as Array<{ id: string; sku: string; name: Record<string, string> | string | null }>;
  const map = new Map<string, { name: string; sku: string }>();
  for (const r of rows) {
    map.set(r.id, { name: pickFromMultilingual(r.name) ?? r.sku, sku: r.sku });
  }
  return map;
}

async function loadWarehouseNames(
  em: EntityManager,
  ids: string[],
): Promise<Map<string, { name: string; code: string }>> {
  const rows = (await em.getConnection().execute(
    'select id::text as id, name, code from warehouses where id in (?)',
    [ids],
  )) as Array<{ id: string; name: string; code: string }>;
  const map = new Map<string, { name: string; code: string }>();
  for (const r of rows) map.set(r.id, { name: r.name, code: r.code });
  return map;
}

async function loadPriceListNames(
  em: EntityManager,
  ids: string[],
): Promise<Map<string, { name: string; code: string }>> {
  const rows = (await em.getConnection().execute(
    'select id::text as id, name, code from price_lists where id in (?)',
    [ids],
  )) as Array<{ id: string; name: string; code: string }>;
  const map = new Map<string, { name: string; code: string }>();
  for (const r of rows) map.set(r.id, { name: r.name, code: r.code });
  return map;
}

function pickFromMultilingual(value: Record<string, string> | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.length > 0 ? value : null;
  for (const key of ['en', 'en-US', 'pl', 'pl-PL']) {
    const v = value[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(value)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
