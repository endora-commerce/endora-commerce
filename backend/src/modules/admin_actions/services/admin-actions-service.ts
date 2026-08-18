import { createHash } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type {
  AdminActionView,
  AdminI18nTranslatePort,
  KnownIconName,
  PermissionReadPort,
  SupportedAdminLanguage,
} from '@b2b/contracts';
import { STATE_CHANGED_CHANNEL } from '../../../kernel/lifecycle/registry-cache.js';

/**
 * Admin Actions Service — feature 020.
 *
 * Reads `module_actions` joined with `module_registrations.state =
 * 'installed'`, resolves label/description keys via the feature 019
 * i18n resolver, filters by the operator's permissions, sorts by
 * `(weight asc, locale-aware label asc)`, and caches the result in an
 * in-process `Map` keyed by `(language, permissionFingerprint)`. The
 * cache is cleared on every `b2b:module:state-changed` pub/sub message
 * — any module enable/disable could change visibility for any operator
 * so a coarse clear is correct and trivially cheap at this scale.
 */

interface ModuleActionRow {
  module_id: string;
  action_id: string;
  label_key: string;
  description_key: string | null;
  icon: string;
  target_route: string;
  required_permission: string | null;
  keywords: string[];
  weight: number;
  version: string | number;
}

export interface AdminActionsServiceDeps {
  em: () => EntityManager;
  /**
   * `_i18n`'s resolver and `admin_roles`' permission read, both as the contract
   * types those modules publish rather than their service classes (feature 075,
   * Phase C). What this service asks for is two methods — resolve a string,
   * list an operator's permissions — where the classes brought bundle
   * installation, coverage snapshots and role administration across the
   * boundary with them.
   */
  i18nService: AdminI18nTranslatePort;
  permissionService: PermissionReadPort;
  redisSubscriber?: Redis;
  log?: { info(msg: string): void; warn(msg: string): void };
  /**
   * Feature 073 — the **operator** presence axis, injected.
   *
   * The query below already resolves the platform axis in SQL, freshly, per
   * call. What it cannot see is the operator's activation, which lives in a
   * `settings` row this module has no business joining. Splitting the two this
   * way keeps each axis read once, from its own source of truth.
   *
   * Injected rather than read from the lifecycle singleton so this service
   * stays constructible without a warmed process cache — a test that seeds
   * `module_registrations` and asserts the platform axis must not silently
   * start filtering on an empty in-memory set.
   *
   * Omitted ⇒ every module's operator axis reads as activated, which is the
   * pre-073 behaviour of an unwired composition, not a fall-open: there is no
   * activation state to resolve at all.
   */
  isModuleActivated?: (moduleId: string) => boolean;
}

export interface ListVisibleResult {
  actions: AdminActionView[];
  registryVersion: number;
}

export class AdminActionsService {
  private readonly em: () => EntityManager;
  private readonly i18nService: AdminI18nTranslatePort;
  private readonly permissionService: PermissionReadPort;
  private readonly isModuleActivated: (moduleId: string) => boolean;
  private readonly cache = new Map<string, ListVisibleResult>();
  /** Counts service work so tests can assert cache hits / misses. */
  public stats = { dbHits: 0, cacheHits: 0, invalidations: 0 };

  constructor(deps: AdminActionsServiceDeps) {
    this.em = deps.em;
    this.i18nService = deps.i18nService;
    this.permissionService = deps.permissionService;
    this.isModuleActivated = deps.isModuleActivated ?? ((): boolean => true);

    if (deps.redisSubscriber) {
      void deps.redisSubscriber.subscribe(STATE_CHANGED_CHANNEL);
      deps.redisSubscriber.on('message', (channel) => {
        if (channel !== STATE_CHANGED_CHANNEL) return;
        this.invalidate();
      });
    }
  }

  /** Drop every cached snapshot. Called by the pubsub handler. */
  invalidate(): void {
    this.cache.clear();
    this.stats.invalidations += 1;
  }

  /**
   * List the actions an operator may see in the command palette.
   *
   * Permissions are loaded via the admin_roles `PermissionService`. The
   * action filter is the same as the existing `hasPermission()` check:
   * `*` in the operator's role grants everything; otherwise the action's
   * `requiredPermission` (if any) must be present in the role's array.
   */
  async listVisibleForOperator(args: {
    language: SupportedAdminLanguage;
    adminUserId: string;
  }): Promise<ListVisibleResult> {
    const permissions = await this.permissionService.listPermissions(args.adminUserId);
    const fingerprint = fingerprintPermissions(permissions);
    const cacheKey = `${args.language}::${fingerprint}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.stats.cacheHits += 1;
      return cached;
    }

    this.stats.dbHits += 1;
    const knex = this.em().getKnex();
    const rows = (await knex('module_actions as a')
      .join('module_registrations as r', 'a.module_id', 'r.module_id')
      .where('r.state', 'installed')
      .select(
        'a.module_id',
        'a.action_id',
        'a.label_key',
        'a.description_key',
        'a.icon',
        'a.target_route',
        'a.required_permission',
        'a.keywords',
        'a.weight',
        'a.version',
      )) as ModuleActionRow[];

    const visible: ModuleActionRow[] = [];
    for (const row of rows) {
      // Feature 073 — the join above answered the platform axis; this answers
      // the operator's. A palette that advertises a deactivated module's action
      // leads an operator straight to a 503, which is the same defect as an
      // unfiltered sidebar.
      if (!this.isModuleActivated(row.module_id)) continue;
      if (
        row.required_permission == null ||
        permissions.includes('*') ||
        permissions.includes(row.required_permission)
      ) {
        visible.push(row);
      }
    }

    let registryVersion = 0;
    const collator = new Intl.Collator(args.language, {
      sensitivity: 'base',
      numeric: true,
    });

    const resolved: AdminActionView[] = [];
    for (const row of visible) {
      const v = Number(row.version);
      if (v > registryVersion) registryVersion = v;
      const label = await this.i18nService.translate(
        row.module_id,
        row.label_key,
        args.language,
      );
      let description: string | null = null;
      if (row.description_key) {
        const resolvedDescription = await this.i18nService.translate(
          row.module_id,
          row.description_key,
          args.language,
        );
        // The resolver returns `${moduleId}.${key}` as a placeholder when
        // the key is missing — surface that as `null` rather than a
        // raw-key string in the description slot.
        description =
          resolvedDescription === `${row.module_id}.${row.description_key}`
            ? null
            : resolvedDescription;
      }
      resolved.push({
        moduleId: row.module_id,
        actionId: row.action_id,
        label,
        description,
        icon: row.icon as KnownIconName,
        targetRoute: row.target_route,
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        weight: row.weight,
      });
    }

    resolved.sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      return collator.compare(a.label, b.label);
    });

    const result: ListVisibleResult = { actions: resolved, registryVersion };
    this.cache.set(cacheKey, result);
    return result;
  }
}

/**
 * Stable hash of an operator's permission set. Sorting first makes the
 * fingerprint independent of insertion order; sha1 keeps the cache key
 * compact while making collisions astronomically unlikely.
 */
export function fingerprintPermissions(permissions: readonly string[]): string {
  const sorted = [...permissions].sort();
  return createHash('sha1').update(sorted.join('\0')).digest('hex').slice(0, 16);
}
