import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ApplicationRule } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListItem } from '../entities/price-list-item.entity.js';
import { PriceListAssignment } from '../entities/price-list-assignment.entity.js';
import { PriceListProduct } from '../entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../entities/price-list-price-bracket.entity.js';
import { PriceDisplayModeOverride } from '../entities/price-display-mode-override.entity.js';
import { CustomerGroup } from '../entities/customer-group.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { Category } from '../../catalog/entities/category.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { Setting } from '../../settings/entities/setting.entity.js';
import { SettingValue } from '../../settings/entities/setting-value.entity.js';
import { randomUUID } from 'crypto';

export type DisplayMode = 'gross_only' | 'net_only' | 'both' | 'none';
export type DisplayModeOverrideScope = 'organization' | 'category' | 'product';

export type PriceListStatus = 'draft' | 'active' | 'scheduled' | 'expired';
export type PriceListType = 'base' | 'sale';

export interface CreatePriceListInput {
  name: string;
  type: PriceListType;
  startsAt?: Date | null;
  endsAt?: Date | null;
  applicationRule?: ApplicationRule;
}

export interface PatchPriceListInput {
  name?: string;
  type?: PriceListType;
  startsAt?: Date | null;
  endsAt?: Date | null;
  applicationRule?: ApplicationRule;
}

export interface BracketInput {
  minQuantity: number;
  maxQuantity: number | null;
  /** Decimal amount as string (the storage shape on `price_list_price_brackets`). */
  amount: string;
}

export interface ReplaceProductsResult {
  added: number;
  removed: number;
  unchanged: number;
}

export interface CopyCurrencyResult {
  added: number;
}

/**
 * PriceListService — admin CRUD over PriceList + the two child collections
 * (items + assignments). Keeping all three operations on the same service
 * keeps the "edit a price list and its rules" admin flow on one transaction
 * boundary when we need it later.
 */
export class PriceListService {
  constructor(private readonly emFactory: () => EntityManager) {}

  // ---- PriceList -----------------------------------------------------

  async list(): Promise<PriceList[]> {
    return this.emFactory().find(PriceList, {}, { orderBy: { priority: 'desc', code: 'asc' } });
  }

  async getById(id: string, em?: EntityManager): Promise<PriceList> {
    const ent = em ?? this.emFactory();
    const row = await ent.findOne(PriceList, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Price list ${id} not found.`);
    return row;
  }

  async upsertByCode(input: {
    code: string;
    name: string;
    currency: string;
    isDefault?: boolean | undefined;
    priority?: number | undefined;
  }): Promise<PriceList> {
    const em = this.emFactory();
    const existing = await em.findOne(PriceList, { code: input.code });
    if (input.isDefault) {
      // The unique partial index `(is_default) WHERE is_default=true` enforces
      // at most one default. Demote the prior default first so the swap is
      // atomic.
      await em.getConnection().execute(
        `update price_lists set is_default = false where is_default = true and code <> ?`,
        [input.code],
      );
    }
    if (existing) {
      existing.name = input.name;
      existing.currency = input.currency;
      if (input.isDefault !== undefined) existing.isDefault = input.isDefault;
      if (input.priority !== undefined) existing.priority = input.priority;
      await em.flush();
      return existing;
    }
    const row = em.create(PriceList, {
      code: input.code,
      name: input.name,
      currency: input.currency,
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(PriceList, { id });
    if (!row) return;
    if (row.isSystem) {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'The Default price list cannot be deleted; it is the system fallback.',
      );
    }
    await em.removeAndFlush(row);
  }

  /**
   * Default-list rule-attachment guard (FR-006). Rejects any attempt to attach
   * a non-empty Application Rule to the seeded `Default` row.
   */
  async assertCanSetApplicationRule(
    id: string,
    rule: { kind: string },
  ): Promise<void> {
    const row = await this.getById(id);
    if (row.isSystem && rule.kind !== 'all') {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'The Default price list cannot carry an Application Rule; it always matches as the global fallback.',
      );
    }
  }

  /**
   * Default-list status-change guard (FR-005 / FR-006 / spec.md §State Machines).
   * The system Default row stays `active` for the platform's lifetime. The
   * service rejects any attempt to move it to `draft`, `scheduled`, or `expired`.
   */
  async assertCanTransitionStatus(
    id: string,
    nextStatus: 'draft' | 'active' | 'scheduled' | 'expired',
  ): Promise<void> {
    const row = await this.getById(id);
    if (row.isSystem && nextStatus !== 'active') {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'The Default price list must remain active.',
      );
    }
  }

  // ---- Engine CRUD + lifecycle (feature 011) -------------------------

  /**
   * Create a new price list. Status defaults to `draft`. Default-list
   * protections are out of scope here — system rows are seeded by migration
   * 031, never created via this method.
   */
  async create(input: CreatePriceListInput): Promise<PriceList> {
    this.assertDateSanity(input.startsAt ?? null, input.endsAt ?? null, true);
    const normalisedRule =
      input.applicationRule !== undefined
        ? await this.normaliseAndValidateRule(input.applicationRule)
        : { kind: 'all' as const };
    const em = this.emFactory();
    const row = em.create(PriceList, {
      // Legacy columns are required by the foundation schema; populate them
      // with engine-equivalent values so writes don't fail until contract
      // migration retires them.
      code: `pl-${randomUUID()}`,
      name: input.name,
      currency: 'PLN',
      isDefault: false,
      priority: 0,
      type: input.type,
      status: 'draft',
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      applicationRule: normalisedRule,
      isSystem: false,
      modifiedAt: new Date(),
    });
    await em.persistAndFlush(row);
    return row;
  }

  /**
   * Partial update. Bumps `modifiedAt` on every material change.
   * Refuses non-empty rule attachment on the seeded `Default` row (FR-006).
   */
  async patch(id: string, input: PatchPriceListInput): Promise<PriceList> {
    const em = this.emFactory();
    const row = await this.getById(id, em);

    let normalisedRule: ApplicationRule | undefined;
    if (input.applicationRule !== undefined) {
      await this.assertCanSetApplicationRule(id, input.applicationRule);
      normalisedRule = await this.normaliseAndValidateRule(input.applicationRule);
    }

    const nextStartsAt = input.startsAt !== undefined ? input.startsAt : row.startsAt ?? null;
    const nextEndsAt = input.endsAt !== undefined ? input.endsAt : row.endsAt ?? null;
    if (input.startsAt !== undefined || input.endsAt !== undefined) {
      this.assertDateSanity(nextStartsAt, nextEndsAt, false);
    }

    let mutated = false;
    if (input.name !== undefined && input.name !== row.name) {
      row.name = input.name;
      mutated = true;
    }
    if (input.type !== undefined && input.type !== row.type) {
      row.type = input.type;
      mutated = true;
    }
    if (input.startsAt !== undefined) {
      row.startsAt = input.startsAt;
      mutated = true;
    }
    if (input.endsAt !== undefined) {
      row.endsAt = input.endsAt;
      mutated = true;
    }
    if (input.applicationRule !== undefined && normalisedRule !== undefined) {
      row.applicationRule = normalisedRule;
      mutated = true;
    }
    if (mutated) {
      row.modifiedAt = new Date();
    }
    await em.flush();
    return row;
  }

  /**
   * Manual transition: draft → active (or scheduled / expired if dates
   * dictate). FR-009 row 1.
   */
  async activate(id: string): Promise<PriceList> {
    const em = this.emFactory();
    const row = await this.getById(id, em);
    // FR-023: a non-Default list cannot leave `draft` while its rule is empty.
    if (!row.isSystem && row.applicationRule.kind === 'all') {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'A non-Default price list cannot be activated with an empty Application Rule.',
      );
    }
    const now = new Date();
    const next: PriceListStatus =
      row.startsAt && row.startsAt > now
        ? 'scheduled'
        : row.endsAt && row.endsAt < now
          ? 'expired'
          : 'active';
    if (row.status === next) return row;
    await this.assertCanTransitionStatus(id, next);
    row.status = next;
    row.modifiedAt = new Date();
    await em.flush();
    return row;
  }

  /**
   * Manual transition: any state → draft. Freezes the list immediately.
   */
  async draftify(id: string): Promise<PriceList> {
    const em = this.emFactory();
    const row = await this.getById(id, em);
    if (row.status === 'draft') return row;
    await this.assertCanTransitionStatus(id, 'draft');
    row.status = 'draft';
    row.modifiedAt = new Date();
    await em.flush();
    return row;
  }

  /**
   * Duplicate a price list. Copies the rule, the assigned products, and
   * every bracket row. Resets status to `draft`, clears dates, and derives
   * a unique name (suffix ` (copy)`, ` (copy 2)`, …) — FR-013.
   */
  async duplicate(id: string): Promise<PriceList> {
    const em = this.emFactory();
    const source = await this.getById(id, em);

    const baseName = source.name;
    const candidates = await em.find(
      PriceList,
      { name: { $like: `${baseName} (copy%` } },
      { fields: ['id', 'name'] },
    );
    let suffix = ' (copy)';
    if (candidates.length > 0) {
      // Find the next available numeric suffix.
      let n = 2;
      while (candidates.some((c) => c.name === `${baseName} (copy ${n})`)) {
        n += 1;
      }
      // If the bare " (copy)" doesn't exist yet, use it.
      if (!candidates.some((c) => c.name === `${baseName} (copy)`)) {
        suffix = ' (copy)';
      } else {
        suffix = ` (copy ${n})`;
      }
    }
    const newName = `${baseName}${suffix}`;

    const dup = em.create(PriceList, {
      code: `pl-${randomUUID()}`,
      name: newName,
      currency: source.currency,
      isDefault: false,
      priority: 0,
      type: source.type,
      status: 'draft',
      startsAt: null,
      endsAt: null,
      applicationRule: structuredClone(source.applicationRule),
      isSystem: false,
      modifiedAt: new Date(),
    });
    await em.persistAndFlush(dup);

    // Copy assignments first (FK target), then brackets.
    const products = await em.find(PriceListProduct, { priceListId: source.id });
    for (const p of products) {
      em.create(PriceListProduct, { priceListId: dup.id, productId: p.productId });
    }
    await em.flush();

    const brackets = await em.find(PriceListPriceBracket, { priceListId: source.id });
    for (const b of brackets) {
      em.create(PriceListPriceBracket, {
        priceListId: dup.id,
        productId: b.productId,
        currencyCode: b.currencyCode,
        minQuantity: b.minQuantity,
        maxQuantity: b.maxQuantity ?? null,
        amount: b.amount,
      });
    }
    await em.flush();

    return dup;
  }

  /**
   * Normalise + validate an Application Rule (US4 / FR-020..FR-024).
   *
   * Steps in order:
   *   1. Recursively walk the AST.
   *   2. For criteria: dedupe values, uppercase currency codes, validate
   *      target IDs against their respective tables. Empty `values` arrays
   *      collapse to `{ kind: 'all' }`.
   *   3. For groups: recursively normalise each child, then drop children
   *      that collapsed to `{ kind: 'all' }`. If the group becomes empty
   *      it collapses to `{ kind: 'all' }` as well; if it's left with a
   *      single child, that child takes its place.
   *   4. Reject malformed currencies, depth > 5, and unknown target IDs
   *      with `400 VALIDATION_FAILED`.
   *
   * Returns the normalised rule. Does NOT enforce FR-023 (non-Default
   * rules must be non-empty); that gate fires at activation time.
   */
  async normaliseAndValidateRule(rule: ApplicationRule): Promise<ApplicationRule> {
    return this.normaliseRuleNode(rule, 0);
  }

  private async normaliseRuleNode(node: ApplicationRule, depth: number): Promise<ApplicationRule> {
    if (depth > 5) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Application rule exceeds the maximum nesting depth of 5.',
      );
    }
    if (node.kind === 'all') return node;

    if (node.kind === 'criterion') {
      // Currency: uppercase, validate format.
      if (node.type === 'currency') {
        const upper = node.values.map((v) => v.toUpperCase());
        for (const v of upper) {
          if (!/^[A-Z]{3}$/.test(v)) {
            throw new HttpError(
              400,
              ERROR_CODES.VALIDATION_FAILED,
              `Invalid currency code in rule: ${v}`,
            );
          }
        }
        const dedup = Array.from(new Set(upper));
        if (dedup.length === 0) return { kind: 'all' };
        return { kind: 'criterion', type: 'currency', values: dedup };
      }
      // ID-based criterion types.
      const dedup = Array.from(new Set(node.values));
      if (dedup.length === 0) return { kind: 'all' };
      await this.assertTargetsExist(node.type, dedup);
      return { kind: 'criterion', type: node.type, values: dedup };
    }

    // Group node.
    const childResults: ApplicationRule[] = [];
    for (const child of node.children) {
      const normalised = await this.normaliseRuleNode(child, depth + 1);
      childResults.push(normalised);
    }
    // Drop "all" children — they don't constrain the group.
    const meaningful = childResults.filter((c) => c.kind !== 'all');
    if (meaningful.length === 0) {
      return { kind: 'all' };
    }
    if (meaningful.length === 1) {
      return meaningful[0]!;
    }
    return { kind: 'group', op: node.op, children: meaningful };
  }

  /**
   * Validate that every value in an ID-based criterion is a real row in the
   * appropriate table. Throws `400 VALIDATION_FAILED` for any unknown ID.
   */
  private async assertTargetsExist(
    type: 'salesChannel' | 'customerGroup' | 'organization' | 'category',
    ids: readonly string[],
  ): Promise<void> {
    const em = this.emFactory();
    let found: number;
    switch (type) {
      case 'salesChannel':
        found = await em.count(SalesChannel, { id: { $in: ids } });
        break;
      case 'customerGroup':
        found = await em.count(CustomerGroup, { id: { $in: ids } });
        break;
      case 'organization':
        found = await em.count(Organization, { id: { $in: ids } });
        break;
      case 'category':
        found = await em.count(Category, { id: { $in: ids } });
        break;
    }
    if (found !== ids.length) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `One or more ${type} IDs in the rule do not exist.`,
      );
    }
  }

  /**
   * Date sanity per FR-010: `endsAt` must be greater than `startsAt`; at
   * creation time `endsAt` must be in the future.
   */
  private assertDateSanity(
    startsAt: Date | null,
    endsAt: Date | null,
    onCreate: boolean,
  ): void {
    if (endsAt && startsAt && endsAt <= startsAt) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'endsAt must be greater than startsAt.',
      );
    }
    if (onCreate && endsAt && endsAt < new Date()) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'endsAt must be in the future at creation time.',
      );
    }
  }

  // ---- Engine: linked price-lists panel (US8) ------------------------

  /**
   * For a given product, return every price list the product is assigned
   * to with a per-currency bracket summary and a deep-link path. Powers
   * the admin Catalog product editor's Pricing tab (FR-044/045/046).
   */
  async summarizeBracketsForProduct(
    productId: string,
  ): Promise<
    Array<{
      list: {
        id: string;
        name: string;
        type: 'base' | 'sale';
        status: 'draft' | 'active' | 'scheduled' | 'expired';
        modifiedAt: Date;
      };
      summary: Array<{ currencyCode: string; summary: string }>;
      deepLinkPath: string;
    }>
  > {
    const em = this.emFactory();
    const assignments = await em.find(PriceListProduct, { productId });
    if (assignments.length === 0) return [];
    const listIds = assignments.map((a) => a.priceListId);

    const lists = await em.find(
      PriceList,
      { id: { $in: listIds } },
      { orderBy: { isSystem: 'desc', name: 'asc' } },
    );
    const brackets = await em.find(
      PriceListPriceBracket,
      { priceListId: { $in: listIds }, productId },
      { orderBy: { currencyCode: 'asc', minQuantity: 'asc' } },
    );

    return lists.map((list) => {
      const listBrackets = brackets.filter((b) => b.priceListId === list.id);
      const byCurrency = listBrackets.reduce<Record<string, PriceListPriceBracket[]>>(
        (acc, b) => {
          (acc[b.currencyCode] ??= []).push(b);
          return acc;
        },
        {},
      );
      const summary = Object.entries(byCurrency)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currencyCode, rows]) => ({
          currencyCode,
          summary: this.summariseBrackets(rows),
        }));
      return {
        list: {
          id: list.id,
          name: list.name,
          type: list.type,
          status: list.status,
          modifiedAt: list.modifiedAt,
        },
        summary,
        deepLinkPath: `/admin/price-lists/${list.id}/products?focus=${productId}`,
      };
    });
  }

  /**
   * Build a human-readable summary string for one currency's bracket
   * series, e.g.:
   *   - "80,0000 across 1 bracket"
   *   - "80,0000 – 100,0000 across 3 brackets"
   * The numeric formatting deliberately keeps the storage scale (4
   * fractional digits); the admin UI may re-format per locale.
   */
  private summariseBrackets(rows: readonly PriceListPriceBracket[]): string {
    if (rows.length === 0) return 'no brackets';
    const amounts = rows.map((r) => Number(r.amount));
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const count = rows.length;
    const noun = count === 1 ? 'bracket' : 'brackets';
    if (min === max) {
      return `${this.formatAmount(min)} across ${count} ${noun}`;
    }
    return `${this.formatAmount(min)} – ${this.formatAmount(max)} across ${count} ${noun}`;
  }

  private formatAmount(value: number): string {
    return value.toFixed(4);
  }

  // ---- Engine: display mode (US7) ------------------------------------

  /**
   * Upsert a per-Org / per-Category / per-Product display-mode override
   * (FR-038). The mode value `'inherit'` deletes the override row.
   * Validates the target ID against the appropriate table — orphans are
   * refused with 400 (the polymorphic FK is enforced here, not at the DB
   * level, since the target table varies — see data-model.md §1.4).
   */
  async upsertDisplayModeOverride(
    scope: DisplayModeOverrideScope,
    targetId: string,
    mode: DisplayMode | 'inherit',
  ): Promise<PriceDisplayModeOverride | null> {
    const em = this.emFactory();
    await this.assertOverrideTargetExists(em, scope, targetId);
    const existing = await em.findOne(PriceDisplayModeOverride, { scope, targetId });
    if (mode === 'inherit') {
      if (existing) {
        await em.removeAndFlush(existing);
      }
      return null;
    }
    if (existing) {
      existing.mode = mode;
      existing.updatedAt = new Date();
      await em.flush();
      return existing;
    }
    const row = em.create(PriceDisplayModeOverride, { scope, targetId, mode });
    await em.persistAndFlush(row);
    return row;
  }

  async listDisplayModeOverrides(
    scope?: DisplayModeOverrideScope,
  ): Promise<PriceDisplayModeOverride[]> {
    const em = this.emFactory();
    return em.find(
      PriceDisplayModeOverride,
      scope ? { scope } : {},
      { orderBy: { scope: 'asc', targetId: 'asc' } },
    );
  }

  async getDisplayModeOverride(
    scope: DisplayModeOverrideScope,
    targetId: string,
  ): Promise<PriceDisplayModeOverride | null> {
    return this.emFactory().findOne(PriceDisplayModeOverride, { scope, targetId });
  }

  /**
   * Update a `pricing.*` settings-group display-mode key. Settings are
   * per-sales-channel under the foundation settings module — when no
   * channel is supplied, this method writes the value across every
   * sales channel (treating it as a tenant-wide override). For
   * channel-specific overrides, callers may pass a single channel.
   *
   * `key` is the bare suffix (e.g. `default_display_mode` or
   * `unauthenticated_display_mode`) — the full code is derived as
   * `pricing.<key>`.
   */
  async setSettingsDisplayMode(
    key: 'default_display_mode' | 'unauthenticated_display_mode',
    mode: DisplayMode,
    salesChannelId?: string,
  ): Promise<void> {
    const em = this.emFactory();
    const code = `pricing.${key}`;
    const setting = await em.findOneOrFail(Setting, { code });
    const channels = salesChannelId
      ? [await em.findOneOrFail(SalesChannel, { id: salesChannelId })]
      : await em.find(SalesChannel, {});
    for (const channel of channels) {
      const existing = await em.findOne(SettingValue, {
        setting: setting.id,
        salesChannel: channel.id,
      });
      if (existing) {
        existing.value = mode;
        existing.updatedAt = new Date();
        continue;
      }
      em.create(SettingValue, { setting, salesChannel: channel, value: mode });
    }
    await em.flush();
  }

  /**
   * Read the value of a `pricing.*` display-mode setting for a sales
   * channel. Falls back to the Setting's `defaultValue` (manifest
   * default, typically `'gross_only'`).
   */
  async readSettingsDisplayMode(
    key: 'default_display_mode' | 'unauthenticated_display_mode',
    salesChannelId: string,
  ): Promise<DisplayMode> {
    const em = this.emFactory();
    const code = `pricing.${key}`;
    const setting = await em.findOne(Setting, { code });
    if (!setting) return 'gross_only';
    const value = await em.findOne(SettingValue, {
      setting: setting.id,
      salesChannel: salesChannelId,
    });
    const raw = (value?.value ?? setting.defaultValue) as string;
    if (raw === 'gross_only' || raw === 'net_only' || raw === 'both' || raw === 'none') {
      return raw;
    }
    return 'gross_only';
  }

  /**
   * Resolve the effective display mode for a (product, organization?,
   * salesChannel) tuple along the FR-039 chain
   *   Product → Category → Organization → Settings.
   *
   * Walks the product's category memberships to find the most specific
   * category override (deepest in the tree, with `(sort_order ASC, id ASC)`
   * as the deterministic tie-break). Reads override rows from
   * `price_display_mode_overrides`; falls back to the per-channel
   * settings value (`default_display_mode` for signed-in customers,
   * `unauthenticated_display_mode` for guests).
   */
  async resolveDisplayMode(input: {
    productId: string;
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
  }): Promise<DisplayMode> {
    const em = this.emFactory();

    // 1. Product-level override.
    const productOverride = await em.findOne(PriceDisplayModeOverride, {
      scope: 'product',
      targetId: input.productId,
    });
    if (productOverride) return productOverride.mode as DisplayMode;

    // 2. Category-level override — pick the deepest matching category.
    const categoryRows = await em.getConnection().execute<
      Array<{ category_id: string }>
    >(`select category_id from product_categories where product_id = ?`, [input.productId]);
    if (categoryRows.length > 0) {
      const categoryIds = categoryRows.map((r) => r.category_id);
      const overrides = await em.find(PriceDisplayModeOverride, {
        scope: 'category',
        targetId: { $in: categoryIds },
      });
      if (overrides.length > 0) {
        // Pick the deepest category (longest parent chain), with
        // (sort_order ASC, id ASC) as the deterministic tie-break.
        const candidates: Array<{ override: PriceDisplayModeOverride; depth: number; sortOrder: number; id: string }> = [];
        for (const ov of overrides) {
          const cat = await em.findOne(Category, { id: ov.targetId });
          if (!cat) continue;
          const depth = await this.categoryDepth(em, cat.id);
          candidates.push({ override: ov, depth, sortOrder: cat.sortOrder, id: cat.id });
        }
        candidates.sort((a, b) => {
          if (b.depth !== a.depth) return b.depth - a.depth;
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.id.localeCompare(b.id);
        });
        if (candidates.length > 0) return candidates[0]!.override.mode as DisplayMode;
      }
    }

    // 3. Organization-level override (only signed-in customers).
    if (input.customerKind === 'signed_in' && input.organizationId) {
      const orgOverride = await em.findOne(PriceDisplayModeOverride, {
        scope: 'organization',
        targetId: input.organizationId,
      });
      if (orgOverride) return orgOverride.mode as DisplayMode;
    }

    // 4. Settings fallback.
    const key =
      input.customerKind === 'guest'
        ? 'unauthenticated_display_mode'
        : 'default_display_mode';
    return this.readSettingsDisplayMode(key, input.salesChannelId);
  }

  /** Walk the parent chain to compute a category's depth (root = 0). */
  private async categoryDepth(em: EntityManager, categoryId: string): Promise<number> {
    let depth = 0;
    let cursor = await em.findOne(Category, { id: categoryId });
    while (cursor && cursor.parentCategoryId) {
      depth += 1;
      cursor = await em.findOne(Category, { id: cursor.parentCategoryId });
    }
    return depth;
  }

  /**
   * Validate that a polymorphic override target exists in the appropriate
   * table. Throws 400 VALIDATION_FAILED on orphan target IDs (FR-038).
   */
  private async assertOverrideTargetExists(
    em: EntityManager,
    scope: DisplayModeOverrideScope,
    targetId: string,
  ): Promise<void> {
    let exists: number;
    switch (scope) {
      case 'organization':
        exists = await em.count(Organization, { id: targetId });
        break;
      case 'category':
        exists = await em.count(Category, { id: targetId });
        break;
      case 'product':
        exists = await em.count(Product, { id: targetId });
        break;
    }
    if (exists === 0) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `No ${scope} found with id ${targetId} for display-mode override.`,
      );
    }
  }

  // ---- Engine: product roster + bracket pricing (US3) ----------------

  /**
   * List the assigned products for a price list, with their per-currency
   * brackets in `minQuantity` ascending order. Powers the admin Products
   * tab and the linked-price-lists panel from US8.
   */
  async listProducts(priceListId: string): Promise<
    Array<{
      productId: string;
      bracketsByCurrency: Record<string, BracketInput[]>;
    }>
  > {
    await this.getById(priceListId);
    const em = this.emFactory();
    const assignments = await em.find(PriceListProduct, { priceListId });
    if (assignments.length === 0) return [];
    const productIds = assignments.map((a) => a.productId);
    const brackets = await em.find(
      PriceListPriceBracket,
      { priceListId, productId: { $in: productIds } },
      { orderBy: { currencyCode: 'asc', minQuantity: 'asc' } },
    );
    const byProduct = new Map<string, Record<string, BracketInput[]>>();
    for (const id of productIds) byProduct.set(id, {});
    for (const b of brackets) {
      const buckets = byProduct.get(b.productId);
      if (!buckets) continue;
      (buckets[b.currencyCode] ??= []).push({
        minQuantity: b.minQuantity,
        maxQuantity: b.maxQuantity ?? null,
        amount: b.amount,
      });
    }
    return assignments.map((a) => ({
      productId: a.productId,
      bracketsByCurrency: byProduct.get(a.productId) ?? {},
    }));
  }

  /**
   * Idempotent append: assigns a single product to a price list. No-op when
   * the assignment already exists. The list's `modifiedAt` is bumped only
   * when the assignment is actually new.
   */
  async addProduct(priceListId: string, productId: string): Promise<void> {
    const em = this.emFactory();
    const list = await this.getById(priceListId, em);
    const existing = await em.findOne(PriceListProduct, { priceListId, productId });
    if (existing) return;
    em.create(PriceListProduct, { priceListId, productId });
    list.modifiedAt = new Date();
    await em.flush();
  }

  /**
   * Removes a product's assignment + its bracket rows (cascade via FK).
   * No-op when the assignment does not exist.
   */
  async removeProduct(priceListId: string, productId: string): Promise<void> {
    const em = this.emFactory();
    const list = await this.getById(priceListId, em);
    const existing = await em.findOne(PriceListProduct, { priceListId, productId });
    if (!existing) return;
    await em.removeAndFlush(existing);
    list.modifiedAt = new Date();
    await em.flush();
  }

  /**
   * Bulk delta replacement of the product roster. Adds new pairs, removes
   * pairs absent from the request. Returns the {added, removed, unchanged}
   * counts. Cascade deletes brackets for removed pairs.
   */
  async replaceProducts(
    priceListId: string,
    productIds: readonly string[],
  ): Promise<ReplaceProductsResult> {
    const em = this.emFactory();
    const list = await this.getById(priceListId, em);

    const existing = await em.find(PriceListProduct, { priceListId });
    const existingSet = new Set(existing.map((e) => e.productId));
    const wanted = new Set(productIds);

    const toAdd = [...wanted].filter((id) => !existingSet.has(id));
    const toRemove = existing.filter((e) => !wanted.has(e.productId));
    const unchanged = [...wanted].filter((id) => existingSet.has(id));

    for (const id of toAdd) em.create(PriceListProduct, { priceListId, productId: id });
    for (const row of toRemove) em.remove(row);
    if (toAdd.length > 0 || toRemove.length > 0) {
      list.modifiedAt = new Date();
    }
    await em.flush();

    return { added: toAdd.length, removed: toRemove.length, unchanged: unchanged.length };
  }

  /**
   * Bulk replacement of bracket rows for one (list, product) pair across
   * every currency in the request. Currencies absent from the input are
   * cleared. Brackets are validated for:
   *   - assignment existence (404 when product is not in the list);
   *   - per-row sanity: minQuantity ≥ 1, maxQuantity ≥ minQuantity (when
   *     present), amount ≥ 0;
   *   - per-currency overlap freedom (FR-015).
   *
   * The whole save runs in one EM flush so a partial save is impossible.
   */
  async replaceBrackets(
    priceListId: string,
    productId: string,
    bracketsByCurrency: Record<string, readonly BracketInput[]>,
  ): Promise<Record<string, BracketInput[]>> {
    const em = this.emFactory();
    const list = await this.getById(priceListId, em);
    const assignment = await em.findOne(PriceListProduct, { priceListId, productId });
    if (!assignment) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Product ${productId} is not assigned to price list ${priceListId}.`,
      );
    }

    const validated: Record<string, BracketInput[]> = {};
    for (const [currencyRaw, rows] of Object.entries(bracketsByCurrency)) {
      const currency = currencyRaw.toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Invalid currency code: ${currencyRaw}`,
        );
      }
      const sorted = [...rows].sort((a, b) => a.minQuantity - b.minQuantity);
      this.assertBracketSanity(currency, sorted);
      this.assertNoOverlap(currency, sorted);
      validated[currency] = sorted;
    }

    // Replace: remove every existing bracket for the (list, product) pair
    // FIRST, flush, then insert the new rows. The two-flush split keeps
    // MikroORM's UoW from collapsing identical-PK delete+insert pairs.
    const existing = await em.find(PriceListPriceBracket, { priceListId, productId });
    for (const row of existing) em.remove(row);
    if (existing.length > 0) {
      await em.flush();
    }

    const out: Record<string, BracketInput[]> = {};
    for (const [currency, rows] of Object.entries(validated)) {
      const inserted: BracketInput[] = [];
      for (const r of rows) {
        em.create(PriceListPriceBracket, {
          priceListId,
          productId,
          currencyCode: currency,
          minQuantity: r.minQuantity,
          maxQuantity: r.maxQuantity ?? null,
          amount: r.amount,
        });
        inserted.push({
          minQuantity: r.minQuantity,
          maxQuantity: r.maxQuantity ?? null,
          amount: r.amount,
        });
      }
      out[currency] = inserted;
    }
    list.modifiedAt = new Date();
    await em.flush();

    return out;
  }

  /**
   * Convenience: copy one currency's brackets into other currencies for the
   * same (list, product) pair. The target currencies' existing brackets (if
   * any) are NOT cleared — this method appends. Conflicts on
   * `(currency, minQuantity)` are refused via the PK constraint (caller
   * should normally use this on currencies with no brackets yet, e.g. via
   * the admin "Copy currency" affordance).
   */
  async copyCurrencyBrackets(
    priceListId: string,
    productId: string,
    fromCurrency: string,
    toCurrencies: readonly string[],
  ): Promise<CopyCurrencyResult> {
    const em = this.emFactory();
    const list = await this.getById(priceListId, em);
    const assignment = await em.findOne(PriceListProduct, { priceListId, productId });
    if (!assignment) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Product ${productId} is not assigned to price list ${priceListId}.`,
      );
    }
    const source = await em.find(PriceListPriceBracket, {
      priceListId,
      productId,
      currencyCode: fromCurrency.toUpperCase(),
    });
    if (source.length === 0) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Source currency ${fromCurrency} has no brackets for this product.`,
      );
    }

    let added = 0;
    for (const targetRaw of toCurrencies) {
      const target = targetRaw.toUpperCase();
      if (target === fromCurrency.toUpperCase()) continue;
      if (!/^[A-Z]{3}$/.test(target)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Invalid currency code: ${targetRaw}`,
        );
      }
      for (const b of source) {
        const conflict = await em.findOne(PriceListPriceBracket, {
          priceListId,
          productId,
          currencyCode: target,
          minQuantity: b.minQuantity,
        });
        if (conflict) continue;
        em.create(PriceListPriceBracket, {
          priceListId,
          productId,
          currencyCode: target,
          minQuantity: b.minQuantity,
          maxQuantity: b.maxQuantity ?? null,
          amount: b.amount,
        });
        added += 1;
      }
    }
    if (added > 0) {
      list.modifiedAt = new Date();
    }
    await em.flush();
    return { added };
  }

  /**
   * Per-row bracket sanity (FR-014, FR-015).
   */
  private assertBracketSanity(currency: string, rows: readonly BracketInput[]): void {
    for (const [i, r] of rows.entries()) {
      if (!Number.isInteger(r.minQuantity) || r.minQuantity < 1) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Bracket ${currency}[${i}]: minQuantity must be an integer ≥ 1 (got ${r.minQuantity}).`,
        );
      }
      if (r.maxQuantity != null) {
        if (!Number.isInteger(r.maxQuantity) || r.maxQuantity < r.minQuantity) {
          throw new HttpError(
            400,
            ERROR_CODES.VALIDATION_FAILED,
            `Bracket ${currency}[${i}]: maxQuantity (${r.maxQuantity}) must be an integer ≥ minQuantity (${r.minQuantity}).`,
          );
        }
      }
      const amount = Number(r.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Bracket ${currency}[${i}]: amount must be ≥ 0 (got ${r.amount}).`,
        );
      }
    }
  }

  /**
   * Overlap-freedom within a currency series (FR-015). Assumes the input is
   * sorted ascending by `minQuantity`.
   */
  private assertNoOverlap(currency: string, sorted: readonly BracketInput[]): void {
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      const prevMax = prev.maxQuantity ?? Number.POSITIVE_INFINITY;
      if (prevMax >= curr.minQuantity) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Bracket overlap in ${currency}: [${prev.minQuantity}..${prev.maxQuantity ?? '∞'}] overlaps [${curr.minQuantity}..${curr.maxQuantity ?? '∞'}].`,
        );
      }
    }
  }

  // ---- PriceListItem -------------------------------------------------

  async listItems(priceListId: string): Promise<PriceListItem[]> {
    return this.emFactory().find(PriceListItem, { priceListId }, { orderBy: { mode: 'asc', minQuantity: 'asc' } });
  }

  async createItem(
    priceListId: string,
    input: {
      mode: 'fixed_unit' | 'percentage_off' | 'amount_off';
      productId?: string | null;
      variantId?: string | null;
      categoryId?: string | null;
      minQuantity?: number;
      unitPrice?: number | null;
      adjustmentValue?: number | null;
    },
  ): Promise<PriceListItem> {
    const em = this.emFactory();
    await this.getById(priceListId, em); // 404-guard
    const row = em.create(PriceListItem, {
      priceListId,
      mode: input.mode,
      ...(input.productId !== undefined ? { productId: input.productId } : {}),
      ...(input.variantId !== undefined ? { variantId: input.variantId } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.minQuantity !== undefined ? { minQuantity: input.minQuantity } : {}),
      ...(input.unitPrice !== undefined && input.unitPrice !== null
        ? { unitPrice: String(input.unitPrice) }
        : {}),
      ...(input.adjustmentValue !== undefined && input.adjustmentValue !== null
        ? { adjustmentValue: String(input.adjustmentValue) }
        : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }

  async removeItem(itemId: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(PriceListItem, { id: itemId });
    if (!row) return;
    await em.removeAndFlush(row);
  }

  // ---- PriceListAssignment -------------------------------------------

  async listAssignments(priceListId: string): Promise<PriceListAssignment[]> {
    return this.emFactory().find(PriceListAssignment, { priceListId }, { orderBy: { priority: 'desc' } });
  }

  async createAssignment(
    priceListId: string,
    input: {
      organizationId?: string | null;
      customerGroupId?: string | null;
      salesChannelId?: string | null;
      isDefault?: boolean;
      priority?: number;
    },
  ): Promise<PriceListAssignment> {
    const em = this.emFactory();
    await this.getById(priceListId, em);
    const row = em.create(PriceListAssignment, {
      priceListId,
      ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
      ...(input.customerGroupId !== undefined ? { customerGroupId: input.customerGroupId } : {}),
      ...(input.salesChannelId !== undefined ? { salesChannelId: input.salesChannelId } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }

  async removeAssignment(assignmentId: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(PriceListAssignment, { id: assignmentId });
    if (!row) return;
    await em.removeAndFlush(row);
  }
}
