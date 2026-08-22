import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ApplicationRule } from '@b2b/contracts';
import type {
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CustomerGroupReadPort,
  OrganizationDetailsPort,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListProduct } from '../entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../entities/price-list-price-bracket.entity.js';
import { PriceDisplayModeOverride } from '../entities/price-display-mode-override.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { Setting } from '../../../kernel/settings/setting.entity.js';
import { SettingValue } from '../../../kernel/settings/setting-value.entity.js';
import {
  decideDisplayMode,
  settingsDisplayModeKey,
  type DisplayModeCategoryCandidate,
} from './display-mode-resolver.js';
import { randomUUID } from 'crypto';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import type { Command, CommandBus } from '../../../commands/index.js';
import type { PriceListsAuditContext } from '../plugin.js';

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
 * The neighbours this service has to **ask** rather than query (feature 075
 * Phase C).
 *
 * A price-list rule and a display-mode override both point at rows two other
 * modules own — an organisation, a category, a product — and this service used
 * to validate them with `em.count(Organization, …)` and friends, which is
 * another module's table on this module's connection. It answers rows whatever
 * state that module is in, so an operator with `catalog` switched off could
 * still pin a price list to a category the platform will not serve.
 *
 * Grouped into one object because it is one decision: a composition either
 * knows how to reach its neighbours or it does not, and there is no coherent
 * state where it can resolve categories but not organisations.
 */
export interface PriceListTargetReads {
  organizationDetails: OrganizationDetailsPort;
  catalogCategoryRead: CatalogCategoryReadPort;
  catalogProductRead: CatalogProductReadPort;
  /**
   * Feature 076 (D-79) — customer groups moved to `customer_accounts`, so the
   * rule-target validation reads them the same way it already read
   * organisations and categories.
   */
  customerGroupRead: CustomerGroupReadPort;
}

/**
 * PriceListService — admin CRUD over PriceList + the two child collections
 * (items + assignments). Keeping all three operations on the same service
 * keeps the "edit a price list and its rules" admin flow on one transaction
 * boundary when we need it later.
 */
export class PriceListService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Optional pricing cache. Every write path on this service calls
     * `invalidateAll()` so the next read repopulates from the DB.
     * Coarse but correct — fan-out makes per-tuple invalidation
     * unprofitable until profiling shows otherwise.
     */
    private readonly pricingCache?: { invalidateAll: () => void },
    /** Feature 024 — optional audit log writer. When omitted, no audit
     *  rows are emitted (tests that don't care about audit pass nothing). */
    private readonly auditLog?: AuditPort,
    /**
     * Feature 054 — when injected, `patch` runs through the Command Bus so the
     * update is audited co-transactionally (Principle XIII). Optional: bus-less
     * construction keeps the legacy audit path, byte-identical.
     */
    private readonly commandBus?: CommandBus,
    /**
     * Feature 075 Phase C — the ports behind every rule-target and
     * override-target existence check. Optional in the signature because a
     * price list with no organisation, category or product target never reaches
     * them; **never optional in effect**, because the paths that need them
     * refuse rather than skip when they are absent (see {@link targets}).
     */
    private readonly targetReads?: PriceListTargetReads,
  ) {}

  /**
   * The neighbour ports, or a refusal. Skipping the validation when nothing was
   * wired would turn "this composition cannot reach `catalog`" into "every
   * category id is valid", which is the fail-open shape feature 075 exists to
   * remove.
   */
  private targets(): PriceListTargetReads {
    if (!this.targetReads) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'This price-list operation validates a target owned by `catalog` or `organizations`, ' +
          'and this composition constructed PriceListService without their read ports.',
      );
    }
    return this.targetReads;
  }

  private invalidatePricingCache(): void {
    this.pricingCache?.invalidateAll();
  }

  private async audit(
    action: string,
    row: { id: string; name: string; code?: string },
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
    auditCtx?: PriceListsAuditContext,
  ): Promise<void> {
    if (!this.auditLog || !auditCtx) return;
    await this.auditLog.record({
      actorAdminUserId: auditCtx.actorAdminUserId,
      ...(auditCtx.impersonatedCustomerAccountId !== undefined
        ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
        : {}),
      action,
      objectType: 'price_list',
      objectId: row.id,
      ...(stateBefore !== null ? { stateBefore } : {}),
      ...(stateAfter !== null ? { stateAfter } : {}),
      ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
      ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
      ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
    });
  }

  /**
   * Feature 054 — run a price-list write through the Command Bus so the audit is
   * co-transactional (Principle XIII), or fall back to a self-forked em + the
   * legacy `this.audit()` helper when no bus is wired (bus-less test
   * constructions). `write` performs the mutation on the given em (no flush) and
   * returns the caller result, the audit row identity, and the before/after
   * snapshot; a `skipAudit` result commits with no audit row and no cache flush.
   */
  async #runAudited<T>(
    action: string,
    objectId: string,
    auditCtx: PriceListsAuditContext | undefined,
    write: (em: EntityManager) => Promise<{
      result: T;
      row: { id: string; name: string; code?: string };
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      skipAudit?: boolean;
    }>,
  ): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run({
        action,
        objectType: 'price_list',
        objectId,
        run: async ({ em }) => {
          const w = await write(em);
          if (w.skipAudit) return { result: w.result, skipAudit: true };
          this.invalidatePricingCache();
          return { result: w.result, before: w.before, after: w.after };
        },
      });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush();
    if (!w.skipAudit) {
      this.invalidatePricingCache();
      await this.audit(action, w.row, w.before, w.after, auditCtx);
    }
    return w.result;
  }

  // ---- PriceList -----------------------------------------------------

  async listEngine(filter: {
    status?: PriceListStatus[];
    type?: PriceListType[];
    search?: string;
  } = {}): Promise<PriceList[]> {
    const where: Record<string, unknown> = {};
    if (filter.status && filter.status.length > 0) where['status'] = { $in: filter.status };
    if (filter.type && filter.type.length > 0) where['type'] = { $in: filter.type };
    if (filter.search && filter.search.trim().length > 0) {
      where['name'] = { $ilike: `%${filter.search.trim()}%` };
    }
    return this.emFactory().find(PriceList, where, {
      orderBy: { isSystem: 'desc', modifiedAt: 'desc', name: 'asc' },
    });
  }

  async getById(id: string, em?: EntityManager): Promise<PriceList> {
    const ent = em ?? this.emFactory();
    const row = await ent.findOne(PriceList, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Price list ${id} not found.`);
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.#runAudited('price_list.delete', id, undefined, async (em) => {
      const row = await em.findOne(PriceList, { id });
      if (!row) {
        return { result: undefined, row: { id, name: '' }, before: null, after: null, skipAudit: true };
      }
      if (row.isSystem) {
        throw new HttpError(
          403,
          ERROR_CODES.FORBIDDEN,
          'The Default price list cannot be deleted; it is the system fallback.',
        );
      }
      const before = { name: row.name, code: row.code, type: row.type, status: row.status };
      em.remove(row);
      return { result: undefined, row, before, after: null };
    });
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
  async create(input: CreatePriceListInput, auditCtx?: PriceListsAuditContext): Promise<PriceList> {
    this.assertDateSanity(input.startsAt ?? null, input.endsAt ?? null, true);
    const normalisedRule =
      input.applicationRule !== undefined
        ? await this.normaliseAndValidateRule(input.applicationRule)
        : { kind: 'all' as const };
    const id = randomUUID();
    return this.#runAudited('price_list.create', id, auditCtx, async (em) => {
      const row = em.create(PriceList, {
        id,
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
      return {
        result: row,
        row,
        before: null,
        after: {
          name: row.name,
          code: row.code,
          type: row.type,
          status: row.status,
          startsAt: row.startsAt ?? null,
          endsAt: row.endsAt ?? null,
          applicationRuleKind: row.applicationRule.kind,
        },
      };
    });
  }

  /**
   * Partial update. Bumps `modifiedAt` on every material change.
   * Refuses non-empty rule attachment on the seeded `Default` row (FR-006).
   */
  async patch(
    id: string,
    input: PatchPriceListInput,
    auditCtx?: PriceListsAuditContext,
  ): Promise<PriceList> {
    // Feature 054 — audited path: the Command Bus records the update
    // co-transactionally. No-op patches (nothing changed) skip the audit row.
    if (this.commandBus) {
      return this.commandBus.run(this.#patchCommand(id, input));
    }
    // Legacy fallback (bus-less construction): unaudited unless auditCtx given.
    const em = this.emFactory();
    const r = await this.#applyPatch(em, id, input);
    await em.flush();
    if (r.mutated) {
      this.invalidatePricingCache();
      await this.audit('price_list.update', r.row, r.stateBefore, r.stateAfter, auditCtx);
    }
    return r.row;
  }

  /** The `patch` write expressed as a Command (audited via the bus). */
  #patchCommand(id: string, input: PatchPriceListInput): Command<PriceList> {
    return {
      action: 'price_list.update',
      objectType: 'price_list',
      objectId: id,
      run: async ({ em }) => {
        const r = await this.#applyPatch(em, id, input);
        if (!r.mutated) {
          // Nothing changed → commit without an audit row.
          return { result: r.row, skipAudit: true };
        }
        this.invalidatePricingCache();
        return { result: r.row, before: r.stateBefore, after: r.stateAfter };
      },
    };
  }

  /**
   * Pure patch write on the given em — no flush, no audit, no cache invalidation.
   * Returns the row, whether it mutated, and the before/after snapshots.
   */
  async #applyPatch(
    em: EntityManager,
    id: string,
    input: PatchPriceListInput,
  ): Promise<{
    row: PriceList;
    mutated: boolean;
    stateBefore: Record<string, unknown>;
    stateAfter: Record<string, unknown>;
  }> {
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

    const stateBefore = {
      name: row.name,
      type: row.type,
      status: row.status,
      startsAt: row.startsAt ?? null,
      endsAt: row.endsAt ?? null,
    };
    let mutated = false;
    const changedFields: string[] = [];
    if (input.name !== undefined && input.name !== row.name) {
      row.name = input.name;
      mutated = true;
      changedFields.push('name');
    }
    if (input.type !== undefined && input.type !== row.type) {
      row.type = input.type;
      mutated = true;
      changedFields.push('type');
    }
    if (input.startsAt !== undefined) {
      row.startsAt = input.startsAt;
      mutated = true;
      changedFields.push('startsAt');
    }
    if (input.endsAt !== undefined) {
      row.endsAt = input.endsAt;
      mutated = true;
      changedFields.push('endsAt');
    }
    if (input.applicationRule !== undefined && normalisedRule !== undefined) {
      row.applicationRule = normalisedRule;
      mutated = true;
      changedFields.push('applicationRule');
    }
    if (mutated) {
      row.modifiedAt = new Date();
    }
    const stateAfter = {
      name: row.name,
      type: row.type,
      status: row.status,
      startsAt: row.startsAt ?? null,
      endsAt: row.endsAt ?? null,
      changedFields,
    };
    return { row, mutated, stateBefore, stateAfter };
  }

  /**
   * Manual transition: draft → active (or scheduled / expired if dates
   * dictate). FR-009 row 1.
   */
  async activate(id: string, auditCtx?: PriceListsAuditContext): Promise<PriceList> {
    // Pre-read (no mutation) to resolve the dynamic action token before running
    // the audited write: `price_list.activate` for a live state, or
    // `price_list.expire` when the start/end dates push it straight to expired.
    const preRow = await this.getById(id);
    if (!preRow.isSystem && preRow.applicationRule.kind === 'all') {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'A non-Default price list cannot be activated with an empty Application Rule.',
      );
    }
    const now = new Date();
    const next: PriceListStatus =
      preRow.startsAt && preRow.startsAt > now
        ? 'scheduled'
        : preRow.endsAt && preRow.endsAt < now
          ? 'expired'
          : 'active';
    const action = next === 'expired' ? 'price_list.expire' : 'price_list.activate';
    return this.#runAudited(action, id, auditCtx, async (em) => {
      const row = await this.getById(id, em);
      if (row.status === next) return { result: row, row, before: null, after: null, skipAudit: true };
      await this.assertCanTransitionStatus(id, next);
      const previousStatus = row.status;
      row.status = next;
      row.modifiedAt = new Date();
      return {
        result: row,
        row,
        before: { status: previousStatus },
        after: { name: row.name, status: row.status, activatedAt: new Date() },
      };
    });
  }

  /**
   * Manual transition: any state → draft. Freezes the list immediately.
   */
  async draftify(id: string, auditCtx?: PriceListsAuditContext): Promise<PriceList> {
    return this.#runAudited('price_list.draftify', id, auditCtx, async (em) => {
      const row = await this.getById(id, em);
      if (row.status === 'draft') return { result: row, row, before: null, after: null, skipAudit: true };
      await this.assertCanTransitionStatus(id, 'draft');
      const previousStatus = row.status;
      row.status = 'draft';
      row.modifiedAt = new Date();
      return {
        result: row,
        row,
        before: { status: previousStatus },
        after: { name: row.name, status: row.status },
      };
    });
  }

  /**
   * Duplicate a price list. Copies the rule, the assigned products, and
   * every bracket row. Resets status to `draft`, clears dates, and derives
   * a unique name (suffix ` (copy)`, ` (copy 2)`, …) — FR-013.
   */
  async duplicate(id: string, auditCtx?: PriceListsAuditContext): Promise<PriceList> {
    const dupId = randomUUID();
    return this.#runAudited('price_list.duplicate', dupId, auditCtx, async (em) => {
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
        id: dupId,
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
      // `priceListId` is a plain column (not a mapped relation), so the UoW does
      // not order the parent insert first — flush the new list before its
      // children, then assignments before brackets (composite-FK ordering).
      await em.flush();

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

      return {
        result: dup,
        row: dup,
        before: null,
        after: {
          name: dup.name,
          sourcePriceListId: source.id,
          sourceName: source.name,
        },
      };
    });
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
        found = (await this.targets().customerGroupRead.findByIds(ids)).length;
        break;
      case 'organization':
        found = await this.targets().organizationDetails.countByIds(ids);
        break;
      case 'category':
        found = await this.targets().catalogCategoryRead.countByIds(ids);
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
    // command-coverage-ignore: a pricing-DISPLAY config toggle
    // (PriceDisplayModeOverride) — a presentation setting for how prices render,
    // not a price/catalog value mutation, so it is not an admin-audit target.
    const em = this.emFactory();
    await this.assertOverrideTargetExists(scope, targetId);
    const existing = await em.findOne(PriceDisplayModeOverride, { scope, targetId });
    if (mode === 'inherit') {
      if (existing) {
        await em.removeAndFlush(existing);
        this.invalidatePricingCache();
      }
      return null;
    }
    if (existing) {
      existing.mode = mode;
      existing.updatedAt = new Date();
      await em.flush();
      this.invalidatePricingCache();
      return existing;
    }
    const row = em.create(PriceDisplayModeOverride, { scope, targetId, mode });
    await em.persistAndFlush(row);
    this.invalidatePricingCache();
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
    // command-coverage-ignore: writes SettingValue rows owned by the settings
    // module (a cross-module config write); settings changes are the settings
    // module's audit concern, not the price-list admin audit log.
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
   * channel. Resolves along the settings tier chain
   *   per-channel override → global value → manifest `defaultValue`
   * (mirroring `SettingsService.get`). The global tier lives on
   * `settings.global_value` and is what the admin "All channels" editor
   * writes; without it a globally-set mode (e.g. `both`) was ignored and
   * the resolver silently fell back to the manifest default `gross_only`.
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
    const raw = (value?.value ?? setting.globalValue ?? setting.defaultValue) as string;
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

    // 2. Category-level override — the candidates the chain ranks.
    let categoryCandidates: DisplayModeCategoryCandidate[] = [];
    if (!productOverride) {
      const assignments = await this.targets().catalogCategoryRead.listAssignmentsForProducts([
        input.productId,
      ]);
      if (assignments.length > 0) {
        const categoryIds = assignments.map((a) => a.categoryId);
        const overrides = await em.find(PriceDisplayModeOverride, {
          scope: 'category',
          targetId: { $in: categoryIds },
        });
        categoryCandidates = await this.rankCategoryOverrides(overrides);
      }
    }

    // 3. Organization-level override (only signed-in customers).
    const needsOrganization =
      !productOverride &&
      categoryCandidates.length === 0 &&
      input.customerKind === 'signed_in' &&
      input.organizationId !== null;
    const organizationOverride = needsOrganization
      ? await em.findOne(PriceDisplayModeOverride, {
          scope: 'organization',
          targetId: input.organizationId!,
        })
      : null;

    const decision = decideDisplayMode({
      productOverride: (productOverride?.mode as DisplayMode | undefined) ?? null,
      categoryCandidates,
      organizationOverride: (organizationOverride?.mode as DisplayMode | undefined) ?? null,
    });
    if (decision.source !== 'settings') return decision.mode;

    // 4. Settings fallback.
    return this.readSettingsDisplayMode(
      settingsDisplayModeKey(input.customerKind),
      input.salesChannelId,
    );
  }

  /**
   * The chain's answer with **no product in hand** — feature 086 / FR-016.
   *
   * A price ordering and a price range are refused where the page may not show
   * prices at all, and `pricing.unauthenticated_display_mode = none` is the
   * supported "hide prices until login" configuration. Deciding that needs the
   * mode a *page* resolves to, which is the Organization → Settings tail of the
   * FR-039 chain with the product and category steps deliberately absent.
   *
   * **The absence is the ruling, not a shortcut** (spec 086, clarification 2).
   * A single product overridden to `none` keeps its position in a price
   * ordering: a per-product override reads as "ask us for a quote" rather than
   * "this price is secret", and withdrawing the whole control because one
   * product opts out would make the sort appear and disappear as a buyer walks
   * the catalogue. Moving those products to the tail instead is a change to
   * this method's two omitted steps and to nothing else.
   *
   * The decision itself still goes through `decideDisplayMode`, so a page and a
   * card cannot rank the organisation tier differently.
   */
  async resolvePageDisplayMode(input: {
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
  }): Promise<DisplayMode> {
    const em = this.emFactory();
    const organizationOverride =
      input.customerKind === 'signed_in' && input.organizationId !== null
        ? await em.findOne(PriceDisplayModeOverride, {
            scope: 'organization',
            targetId: input.organizationId,
          })
        : null;
    const decision = decideDisplayMode({
      productOverride: null,
      categoryCandidates: [],
      organizationOverride: (organizationOverride?.mode as DisplayMode | undefined) ?? null,
    });
    if (decision.source !== 'settings') return decision.mode;
    return this.readSettingsDisplayMode(
      settingsDisplayModeKey(input.customerKind),
      input.salesChannelId,
    );
  }

  /**
   * The same chain for a **set** of products (issue #132 follow-up).
   *
   * A catalogue listing asked this question once per product, which cost four
   * to six queries per card on the page's hottest read. Every step is a set
   * lookup — the product-scope overrides, the category memberships, the
   * category-scope overrides, the one organization row and the one settings
   * pair — so the whole page costs what a single product used to.
   *
   * The *decision* is not duplicated: both this method and `resolveDisplayMode`
   * hand their four inputs to `decideDisplayMode`, so a batched page cannot
   * rank an override differently from a product page. Only the loading differs.
   *
   * `categoryIdsByProduct` is an optional prefetch for a caller that has
   * already read the memberships — `PricingService.resolveListingPrices` needs
   * them for the application rules and would otherwise read the same table
   * twice per page.
   */
  async resolveDisplayModes(input: {
    productIds: readonly string[];
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
    categoryIdsByProduct?: ReadonlyMap<string, ReadonlySet<string>>;
  }): Promise<Map<string, DisplayMode>> {
    const out = new Map<string, DisplayMode>();
    const productIds = [...new Set(input.productIds)];
    if (productIds.length === 0) return out;
    const em = this.emFactory();

    // 1. Product-scope overrides for the whole set.
    const productOverrides = new Map<string, DisplayMode>();
    for (const row of await em.find(PriceDisplayModeOverride, {
      scope: 'product',
      targetId: { $in: productIds },
    })) {
      productOverrides.set(row.targetId, row.mode as DisplayMode);
    }

    // 2. Category memberships, then the category-scope overrides over their
    //    union — one lookup for the page rather than one per card.
    const undecided = productIds.filter((id) => !productOverrides.has(id));
    const categoryIdsByProduct =
      input.categoryIdsByProduct ?? (await this.loadCategoryMemberships(undecided));
    const categoryUnion = new Set<string>();
    for (const productId of undecided) {
      for (const categoryId of categoryIdsByProduct.get(productId) ?? []) {
        categoryUnion.add(categoryId);
      }
    }
    const rankedByCategory = new Map<string, DisplayModeCategoryCandidate>();
    if (categoryUnion.size > 0) {
      const overrides = await em.find(PriceDisplayModeOverride, {
        scope: 'category',
        targetId: { $in: [...categoryUnion] },
      });
      for (const candidate of await this.rankCategoryOverrides(overrides)) {
        rankedByCategory.set(candidate.categoryId, candidate);
      }
    }

    // 3. The organization row is one row for the whole set.
    let organizationOverride: DisplayMode | null = null;
    if (input.customerKind === 'signed_in' && input.organizationId) {
      const row = await em.findOne(PriceDisplayModeOverride, {
        scope: 'organization',
        targetId: input.organizationId,
      });
      organizationOverride = (row?.mode as DisplayMode | undefined) ?? null;
    }

    // 4. Decide, and read the settings pair once if anything still needs it.
    const needingSettings: string[] = [];
    for (const productId of productIds) {
      const candidates: DisplayModeCategoryCandidate[] = [];
      for (const categoryId of categoryIdsByProduct.get(productId) ?? []) {
        const ranked = rankedByCategory.get(categoryId);
        if (ranked) candidates.push(ranked);
      }
      const decision = decideDisplayMode({
        productOverride: productOverrides.get(productId) ?? null,
        categoryCandidates: candidates,
        organizationOverride,
      });
      if (decision.source === 'settings') needingSettings.push(productId);
      else out.set(productId, decision.mode);
    }
    if (needingSettings.length > 0) {
      const fallback = await this.readSettingsDisplayMode(
        settingsDisplayModeKey(input.customerKind),
        input.salesChannelId,
      );
      for (const productId of needingSettings) out.set(productId, fallback);
    }
    return out;
  }

  /**
   * `(product, category)` memberships for a set of products, read through
   * `catalog`'s port (feature 075 / D-87).
   *
   * One call for the whole set, not one per product: the port takes the array
   * for exactly this reason, and a page turning into a round trip per card is
   * the regression this shape exists to prevent.
   *
   * **Structural, deliberately** — no `activeOnly`. The single-product path
   * ranks the same memberships, and `evaluateApplicationRule`'s `category`
   * criterion tests the raw membership, so narrowing to live categories here
   * would make the display-mode chain and the rule that prices the product
   * disagree about which categories a product is in.
   *
   * Every product asked about gets an entry, so an uncategorised product is an
   * empty set rather than a missing key.
   */
  private async loadCategoryMemberships(
    productIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (const id of productIds) out.set(id, new Set());
    if (productIds.length === 0) return out;
    for (const assignment of await this.targets().catalogCategoryRead.listAssignmentsForProducts(
      productIds,
    )) {
      out.get(assignment.productId)?.add(assignment.categoryId);
    }
    return out;
  }

  /**
   * Turn category-scope override rows into the chain's ranking inputs.
   *
   * `ancestorsOf` answers the category **and** its ancestors, nearest-first, so
   * one port call replaces the `findOne` plus the parent-pointer loop that
   * walked `catalog`'s table a level at a time. Depth is the chain length minus
   * the category itself; an unknown id answers an empty chain and is dropped,
   * which is what the old `continue` did.
   */
  private async rankCategoryOverrides(
    overrides: readonly PriceDisplayModeOverride[],
  ): Promise<DisplayModeCategoryCandidate[]> {
    const out: DisplayModeCategoryCandidate[] = [];
    for (const override of overrides) {
      const chain = await this.targets().catalogCategoryRead.ancestorsOf(override.targetId);
      const category = chain[0];
      if (!category) continue;
      out.push({
        mode: override.mode as DisplayMode,
        depth: chain.length - 1,
        sortOrder: category.sortOrder,
        categoryId: category.id,
      });
    }
    return out;
  }

  /**
   * Validate that a polymorphic override target exists in the appropriate
   * table. Throws 400 VALIDATION_FAILED on orphan target IDs (FR-038).
   */
  private async assertOverrideTargetExists(
    scope: DisplayModeOverrideScope,
    targetId: string,
  ): Promise<void> {
    let exists: number;
    switch (scope) {
      case 'organization':
        exists = await this.targets().organizationDetails.countByIds([targetId]);
        break;
      case 'category':
        exists = await this.targets().catalogCategoryRead.countByIds([targetId]);
        break;
      case 'product':
        exists = await this.targets().catalogProductRead.countByIds([targetId]);
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
    await this.#runAudited('price_list.product_add', priceListId, undefined, async (em) => {
      const list = await this.getById(priceListId, em);
      const existing = await em.findOne(PriceListProduct, { priceListId, productId });
      if (existing) return { result: undefined, row: list, before: null, after: null, skipAudit: true };
      em.create(PriceListProduct, { priceListId, productId });
      list.modifiedAt = new Date();
      return { result: undefined, row: list, before: null, after: { name: list.name, productId } };
    });
  }

  /**
   * Removes a product's assignment + its bracket rows (cascade via FK).
   * No-op when the assignment does not exist.
   */
  async removeProduct(priceListId: string, productId: string): Promise<void> {
    await this.#runAudited('price_list.product_remove', priceListId, undefined, async (em) => {
      const list = await this.getById(priceListId, em);
      const existing = await em.findOne(PriceListProduct, { priceListId, productId });
      if (!existing) return { result: undefined, row: list, before: null, after: null, skipAudit: true };
      em.remove(existing);
      list.modifiedAt = new Date();
      return { result: undefined, row: list, before: null, after: { name: list.name, productId } };
    });
  }

  /**
   * Bulk delta replacement of the product roster. Adds new pairs, removes
   * pairs absent from the request. Returns the {added, removed, unchanged}
   * counts. Cascade deletes brackets for removed pairs.
   */
  async replaceProducts(
    priceListId: string,
    productIds: readonly string[],
    auditCtx?: PriceListsAuditContext,
  ): Promise<ReplaceProductsResult> {
    return this.#runAudited('price_list.products_replace', priceListId, auditCtx, async (em) => {
      const list = await this.getById(priceListId, em);

      const existing = await em.find(PriceListProduct, { priceListId });
      const existingSet = new Set(existing.map((e) => e.productId));
      const wanted = new Set(productIds);

      const toAdd = [...wanted].filter((id) => !existingSet.has(id));
      const toRemove = existing.filter((e) => !wanted.has(e.productId));
      const unchanged = [...wanted].filter((id) => existingSet.has(id));

      for (const id of toAdd) em.create(PriceListProduct, { priceListId, productId: id });
      for (const row of toRemove) em.remove(row);
      const result = { added: toAdd.length, removed: toRemove.length, unchanged: unchanged.length };
      if (toAdd.length === 0 && toRemove.length === 0) {
        return { result, row: list, before: null, after: null, skipAudit: true };
      }
      list.modifiedAt = new Date();
      // Feature 024 — a single summary audit row carrying only counts
      // (never the full product-id list — FR-013).
      return {
        result,
        row: list,
        before: null,
        after: {
          name: list.name,
          added: toAdd.length,
          removed: toRemove.length,
          kept: unchanged.length,
        },
      };
    });
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
    auditCtx?: PriceListsAuditContext,
  ): Promise<Record<string, BracketInput[]>> {
    return this.#runAudited('price_list.bracket_update', priceListId, auditCtx, async (em) => {
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

      // Feature 024 — one audit row per (list, product) bracket save, with
      // per-currency bracket counts in the summary (never the raw amounts).
      const summary: Record<string, number> = {};
      for (const [currency, rows] of Object.entries(out)) {
        summary[currency] = rows.length;
      }
      return {
        result: out,
        row: list,
        before: null,
        after: { name: list.name, productId, bracketCountByCurrency: summary },
      };
    });
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
    return this.#runAudited('price_list.bracket_copy', priceListId, undefined, async (em) => {
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
      const result = { added };
      if (added === 0) return { result, row: list, before: null, after: null, skipAudit: true };
      list.modifiedAt = new Date();
      return { result, row: list, before: null, after: { name: list.name, productId, added } };
    });
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

}
