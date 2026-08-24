import type {
  AuditReferenceLabel,
  AuditReferenceRegistryPort,
  KnownIconName,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import type { AuditActorIdentity } from '../routes.admin.js';
import type { RecentActivityCatalog } from './recent-activity-catalog.js';
import type { RecentActivityVisibility } from './recent-activity-visibility.js';

/**
 * Feature 024 — Dashboard "Recent Activity" read service.
 *
 * Curated read view over `audit_log_entries` that powers the admin home
 * dashboard's Recent Activity card. Server-enforced allowlist of action
 * tokens; bulk-resolves actor + target display labels in at most a small
 * fixed number of round-trips (one per object-type bucket).
 *
 * **Where the action list comes from — feature 080, T042j / D-163.1.** It used
 * to come from `action-catalog.ts`: a 23-token array a host maintained by hand,
 * a prefix table beside it, and a `RecentActivityModule` union closed over four
 * core module ids. A module the host had not written could not appear in any of
 * the three, so a package's audit row was **silently absent** from this card
 * rather than refused. Both are derived from the composed manifests now, and
 * what a row's `module` is comes from the module that declared its token.
 *
 * The declaration is only half of it. Whether a declared module's rows appear
 * is the operator's, read per request through {@link RecentActivityVisibility}
 * — per request, because a flip must take effect without a restart, and because
 * a captured answer is a preference frozen at boot.
 *
 * **Where the labels come from — feature 075, D-87.** They used to come from
 * five hand-written SQL statements naming `admin_users`, `products`,
 * `warehouses`, `price_lists`, `customer_accounts` and `organizations`, and the
 * deep-link URLs from a template map spelling three other modules' admin routes.
 * Both are inverted now: the actor name is `auditActorResolver`, the
 * contribution point this module has owned since feature 072, and everything
 * else is `auditReferenceRegistry`, where each owner pushes a resolver for its
 * own object type and supplies its own route. This service knows the audit row
 * and nothing else about anybody's schema.
 */

export interface RecentActivityItem {
  id: string;
  actedAt: string;
  action: string;
  /** The module that declared this action token. Any composed module's id. */
  module: string;
  /**
   * What the card renders for this row, from the declaring module's manifest.
   *
   * They travel on the item because the admin's `ACTIVITY_RENDERING` — the
   * fourth hand-maintained table — was the only thing that knew them, and it
   * knew nothing about a module the SPA was not built with. `labelKey` is
   * relative to `module`'s i18n namespace, so the card resolves it as
   * `t(module, labelKey)` and a package's verb arrives in the operator's
   * language from the package's own bundle.
   */
  icon: KnownIconName;
  labelKey: string;
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
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Every declared action token, derived from the composed manifests. */
    private readonly catalog: RecentActivityCatalog,
    /** The operator's half of D-163.1, asked per request. */
    private readonly visibility: RecentActivityVisibility,
    /**
     * The contribution point this module owns and defaults absent. Called per
     * request, never captured: a resolver held once would go on naming actors
     * after the directory behind it went away.
     */
    private readonly resolveActors: (ids: string[]) => Promise<AuditActorIdentity[]>,
    private readonly references: AuditReferenceRegistryPort,
  ) {}

  async list(input: ListRecentActivityInput = {}): Promise<RecentActivityResponse> {
    const limit = clampLimit(input.limit);

    // The conjunction of the two axes. Empty is answered here rather than by
    // an unfiltered query: with every eligible module hidden, `$in: []` and
    // "no filter" differ by the whole audit trail.
    const actions = await this.visibility.visibleActions();
    if (actions.length === 0) {
      return { data: [], pagination: { limit, fetchedAt: new Date().toISOString() } };
    }

    const em = this.emFactory();

    // The existing `actedAt DESC` index handles the sort; the secondary `id DESC`
    // tiebreak (research §R2) gives the dashboard deterministic ordering when
    // two admins act inside the same second. Row count is bounded by `limit`,
    // so the extra sort key has negligible cost at our volumes.
    const rows = await em.find(
      AuditLogEntry,
      { action: { $in: actions } },
      {
        orderBy: { actedAt: 'desc', id: 'desc' },
        limit,
      },
    );

    const enriched = await this.enrich(rows);

    return {
      data: enriched,
      pagination: { limit, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * Bulk-resolve actor + target labels for the given rows in at most one
   * SQL round-trip per object-type bucket. Never N+1.
   */
  private async enrich(rows: AuditLogEntry[]): Promise<RecentActivityItem[]> {
    if (rows.length === 0) return [];

    // --- Actor labels: this module's own contribution point. ---
    const adminIds = uniqueNonNull(rows.map((r) => r.actorAdminUserId ?? null));
    const adminNames =
      adminIds.length > 0 ? abbreviate(await this.resolveActors(adminIds)) : new Map();

    // --- Every other label: one bucket per reference type, one round trip each. ---
    const [customerNames, ...targetBuckets] = await Promise.all([
      this.references.resolve(
        'customer_account',
        uniqueNonNull(rows.map((r) => r.impersonatedCustomerAccountId ?? null)),
      ),
      ...TARGET_REFERENCE_TYPES.map((type) =>
        this.references.resolve(type, uniqueByType(rows, type)),
      ),
    ]);

    // Ids are UUIDs, so one map across the target types collides with nothing
    // and keeps `resolveTarget` reading the row it was handed.
    const targets = new Map<string, AuditReferenceLabel>();
    for (const bucket of targetBuckets) {
      for (const [id, label] of bucket) targets.set(id, label);
    }

    return rows
      .map((r) => buildItem(r, this.catalog, { adminNames, customerNames, targets }))
      .filter((item): item is RecentActivityItem => item !== null);
  }
}

/**
 * The audit `objectType` values an owner module can put a name and a link on.
 *
 * A type nobody claims resolves to an empty bucket, which is the same answer as
 * a deleted row: the snapshot label, and no link.
 */
const TARGET_REFERENCE_TYPES = ['product', 'warehouse', 'price_list'] as const;

/**
 * "Jan Kowalski" → "Jan K.". The abbreviation is the dashboard card's, which is
 * why it lives here and not in the module that owns the directory: `admin_users`
 * answers who somebody is, and how much of that fits on one line of a widget is
 * this surface's question.
 */
function abbreviate(identities: AuditActorIdentity[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const identity of identities) {
    const first = (identity.firstName ?? '').trim();
    const last = (identity.lastName ?? '').trim();
    const initial = last.length > 0 ? `${last.slice(0, 1)}.` : '';
    const display = [first, initial].filter((s) => s.length > 0).join(' ').trim() || identity.id;
    map.set(identity.id, display);
  }
  return map;
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
  customerNames: ReadonlyMap<string, AuditReferenceLabel>;
  targets: ReadonlyMap<string, AuditReferenceLabel>;
}

/**
 * `null` for a token no composed module declares.
 *
 * The row can only be here by having matched the `$in` built from the same
 * catalog, so this is unreachable in a stable composition — but the alternative
 * is `moduleForAction`'s, which threw with a comment calling itself
 * "defensive: unreachable as long as the allowlist and the prefix table stay
 * aligned". They were not aligned, and a throw here would take the whole card
 * down for one row.
 */
function buildItem(
  r: AuditLogEntry,
  catalog: RecentActivityCatalog,
  lookups: Lookups,
): RecentActivityItem | null {
  const action = r.action;
  const descriptor = catalog.descriptorFor(action);
  if (!descriptor) return null;

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
      lookups.customerNames.get(r.impersonatedCustomerAccountId)?.label ??
      r.impersonatedCustomerAccountId;
    actorDisplayName = `${actorDisplayName} (as ${customerLabel})`;
  }

  // --- Target display + URL ---
  const { targetDisplayName, targetUrl } = resolveTarget(r, lookups);

  return {
    id: r.id,
    actedAt: r.actedAt.toISOString(),
    action,
    module: descriptor.moduleId,
    icon: descriptor.icon,
    labelKey: descriptor.labelKey,
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
      // The snapshot wins over the live row, and always has: the card reports
      // what the action did, so a rename shows the name the actor typed.
      const fromSnapshot = pickProductLabel(after) ?? pickProductLabel(before);
      const live = lookups.targets.get(r.objectId);
      return {
        targetDisplayName: fromSnapshot ?? live?.label ?? r.objectId,
        targetUrl: live?.url ?? null,
      };
    }
    case 'warehouse':
    case 'price_list': {
      const live = lookups.targets.get(r.objectId);
      const fromSnapshot = pickStr(after, 'name') ?? pickStr(before, 'name');
      const fromSnapshotCode = pickStr(after, 'code') ?? pickStr(before, 'code');
      return {
        targetDisplayName: fromSnapshot ?? live?.label ?? fromSnapshotCode ?? r.objectId,
        targetUrl: live?.url ?? null,
      };
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
      // The last fallback used to test `r.action === 'product.bulk_update'` and
      // render the untranslated English string "bulk product update" for it.
      // Two things wrong with one line, and both are D-163's shape one layer
      // down: a host file naming another module's action token, and a
      // user-visible sentence with no `pl`. The id is what every other
      // unlabelled row falls back to, including this switch's own `default`.
      const display =
        fileName && warehouseCode ? `${fileName} → ${warehouseCode}` : fileName ?? r.objectId;
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
  //
  // **The key list is the filter**, and it always was. There used to be a
  // pre-test above it — `objectType !== 'bulk_operation' && action !==
  // 'price_list.products_replace'` — which is a second, hand-written answer to
  // "which rows are bulk-shaped", drifting against the very list below it and
  // naming another module's action token in this host file (D-163's shape, one
  // layer down from the four tables T042j retired). FR-030 is satisfied by the
  // allow-list: a row that carries none of these keys still returns `null`,
  // and a row that carries one is bulk-shaped by the only evidence there is.
  const after = r.stateAfter as Record<string, unknown> | null | undefined;
  if (!after) return null;
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
