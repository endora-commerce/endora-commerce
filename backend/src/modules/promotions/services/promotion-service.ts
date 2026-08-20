import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  dispatchValidatorMode,
  type AttributeValueType,
  type CartSnapshot,
  type CatalogProductReadPort,
  type DictionaryValidator,
  type PromotionAction,
  type PromotionApplication,
  type PromotionCriterion,
  type PromotionRule,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import type { SalesChannelMembershipService } from '../../../kernel/sales-channels/sales-channel-membership.service.js';
import { Promotion } from '../entities/promotion.entity.js';
import { PromotionRuleEntity } from '../entities/promotion-rule.entity.js';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';
import {
  lineMatchesAllCriteria,
  type PromotionRuleAttributeLookup,
  type PromotionRuleEvaluationContext,
} from './promotion-rule-service.js';
import {
  evaluatePromotionRule,
  type PromotionRuleContext,
} from './promotion-rule-evaluator.js';
import {
  createPromotionActionRegistry,
  type PromotionActionRegistry,
} from './promotion-action-registry.js';
import {
  PromotionUsageService,
  type FinalizeAppliedPromotion,
  type UsageContext,
} from './promotion-usage-service.js';
import type { CartApplyContext } from '../actions/types.js';

/**
 * The one question this service asks about promotion-rule attribute metadata.
 * `catalog`'s `CatalogPromoAttributePort` (feature 075, Phase P) satisfies it,
 * and `backend.ts` resolves that port by its published contract type; the
 * narrower shape stays here because a rule evaluation never needs the port's
 * other method.
 */
export interface PromotionRuleCatalogPort {
  getAttributeWithOptions(key: string): Promise<{
    id: string;
    key: string;
    valueType: AttributeValueType;
    isPromoRule: boolean;
    options: Array<{ value: string; label: Record<string, string>; labelDefault: string }>;
  } | null>;
}

/** Audit-log sink for FR-039 skip events. Defaults to `console.info`. */
export interface PromotionAuditLogger {
  info(message: string, fields?: Record<string, unknown>): void;
}

/**
 * PromotionService (T132 / FR-052).
 *
 * `applyToCart(snapshot)` walks every active, in-window promotion and
 * applies the ones the cart is eligible for, returning the adjusted
 * subtotal / discountTotal / deliveryTotal / total + a per-promotion
 * audit list.
 *
 * Application order: code-presented promotions first (so a coupon
 * always trumps an automatic), then automatic ones in `value` desc.
 * Discounts never push the subtotal below zero or delivery below zero.
 */
export class PromotionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 012 / US8 — `catalogPromoAttributePort`, owned by `catalog`: the
     * attribute metadata a rule criterion is validated and evaluated against.
     *
     * **Required** (issue #164). It used to be optional "so legacy tests /
     * composition setups that don't wire this stay green", and production
     * always passed it — an optional dependency nobody omits is a lie in the
     * type: it tells every reader that absence is supported, and it makes the
     * absent branch untested by construction. Both consequences were real.
     * `validateCriteria` opened by returning early, so a composition without
     * the port **accepted a promotion naming an attribute that does not
     * exist**; and no test covered that, because the ten call sites that
     * omitted the port were the ones that never exercised attributes.
     *
     * There is no degrade left to express. Absence is not a state the platform
     * can be in: the container resolves this port for every composition, and
     * `catalog` being switched off makes the call **throw**
     * `ModuleDisabledError` at the resolution seam — which is the explicit
     * answer, and it is the owner's to give. What remains is
     * `getAttributeWithOptions` answering `null`, already explicit in its
     * return type and meaning what it says: no such attribute.
     */
    private readonly catalogPort: PromotionRuleCatalogPort,
    /**
     * Feature 075 Phase C — `catalogProductReadPort`, owned by `catalog`. It
     * replaced an `em.find(Product, …)` this module wrote against `catalog`'s
     * table to hydrate a cart line's attribute values, and it is required for
     * the reason above: a composition that could not read products evaluated
     * every attribute criterion against a line with no attribute values, which
     * is not a degrade an operator would recognise as one.
     */
    private readonly productReadPort: CatalogProductReadPort,
    /**
     * Feature 005 / T027b — the sanctioned bridge accessor for
     * `sales_channel_promotions`: it auto-binds a newly-created Promotion to
     * the system-default channel, and it answers which promotions a channel
     * holds when a cart is evaluated.
     *
     * **Required** (issue #251), and of the four this is the one whose absent
     * form was a Principle XII hole rather than a quiet one. Omitting it did
     * two things at once: a new promotion bound to **no** channel, and
     * `applyToCart` skipped channel filtering altogether — so a promotion an
     * operator scoped to one channel applied in every one of them. Both roots
     * passed the service, so nothing was live; every service built by
     * `test/helpers/promotion-service.ts` was not, which is ten suites
     * asserting against a promotion engine with no channel scope.
     *
     * There is no degrade to express in a return type. `sales_channels` is
     * `nonDeactivatable` and `salesChannelMembershipPort` is a
     * platform-owned container name besides, so absence is not a state a
     * composition can reach.
     */
    private readonly salesChannelMembership: SalesChannelMembershipService,
    /**
     * Feature 037 — the dictionary reference validator, owned by
     * `dictionaries`: it is what makes a promotion's `currency` a code the
     * platform actually knows.
     *
     * **Required** (issue #251). `validateCurrency` opened with "no validator,
     * no validation" and returned, so a composition without it stored a
     * promotion denominated in a currency that does not exist — and the
     * failure surfaced far downstream, at the cart, as a discount in a
     * currency nothing could price. `dictionaries` is a declared dependency
     * and is `nonDeactivatable`, so absence is not a state a composition can
     * reach; an unknown or withdrawn code is already explicit, as the 409 this
     * method raises.
     */
    private readonly dictionaryValidator: DictionaryValidator,
    /**
     * Feature 026 US5 — the Organization status gate: an org-targeted
     * promotion only applies while its Organization is `active`.
     *
     * **Required** (issue #251), and the one `backend.ts` already named in its
     * own comment as *"a gate whose absent form is open"*. Omitted, the check
     * was skipped entirely, so a `blocked` (formerly `suspended`) or
     * `pending_verification` customer kept collecting its negotiated
     * discounts — the exact thing US5 exists to stop.
     *
     * The degrade that **is** real stays in the return type, the way
     * `allowedIdsFor(): Promise<string[] | null>` does: `null` means the
     * Organization could not be read (missing or soft-deleted), and a status
     * that is not `active` — `null` included — skips the org-targeted
     * promotion. That is a closed answer, and it is the only absence this
     * argument has.
     */
    private readonly resolveOrganizationStatus: (orgId: string) => Promise<string | null>,
    /**
     * Feature 054 — co-transactional audit sink (`audit_log_entries`),
     * Principle XIII.
     *
     * **Required** (issue #251). Without it every promotion create, update and
     * delete committed with no audit row, which is not a degrade — it is the
     * write happening unrecorded. `auditLogService` is a platform-owned
     * container name that every composition supplies, so there was never a
     * composition the absent branch described.
     */
    private readonly auditLog: AuditLogService,
    /** Feature 012 / US8 — audit sink for FR-039 skip-on-toggle events. */
    private readonly auditLogger: PromotionAuditLogger = {
      info: (message, fields) => console.warn(`[audit] ${message}`, fields ?? {}),
    },
    /** Feature 045 — pluggable action catalogue. Defaults to the built-ins. */
    private readonly actionRegistry: PromotionActionRegistry = createPromotionActionRegistry(),
  ) {
    this.usageService = new PromotionUsageService(emFactory);
  }

  /** Feature 054 — co-transactional promotion audit on `em` (actor from context). */
  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    recordAuditFromContext(this.auditLog, em, {
      action,
      objectType: 'promotion',
      objectId,
      stateBefore,
      stateAfter,
    });
  }

  private readonly usageService: PromotionUsageService;

  /**
   * Feature 045 (US5) — finalize usage for a placed order. MUST run inside the
   * order-placement transaction (the passed `em` is that tx). Throws 409 if a
   * usage cap is hit at the last moment so the transaction rolls back.
   */
  async finalizeUsage(
    em: EntityManager,
    input: { orderId: string; currency: string; ctx: UsageContext; applied: FinalizeAppliedPromotion[] },
  ): Promise<void> {
    await this.usageService.finalize(em, input);
  }

  /** Expose the action catalogue for the admin `action-types` endpoint. */
  listActionTypes(): Array<{ type: string; labelKey: string }> {
    return this.actionRegistry.list().map((d) => ({ type: d.type, labelKey: d.labelKey }));
  }

  async list(): Promise<Promotion[]> {
    return this.emFactory().find(Promotion, {}, { orderBy: { name: 'asc' } });
  }

  async getById(id: string): Promise<Promotion> {
    const row = await this.emFactory().findOne(Promotion, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Promotion ${id} not found.`);
    return row;
  }

  async upsert(input: UpsertPromotionInput): Promise<Promotion> {
    const em = this.emFactory();
    const existing = input.code
      ? await em.findOne(Promotion, { code: input.code })
      : null;
    await this.validateUpsertInput(em, input, existing);
    const data = buildPromotionData(input);
    if (existing) {
      Object.assign(existing, data);
      this.#audit(em, 'promotion.update', existing.id, null, { name: existing.name, code: existing.code });
      await em.flush();
      return existing;
    }
    // `data` is built from a partial input; `name` is always present per the
    // schema, but the conditional spreads widen the inferred type.
    const row = em.create(Promotion, data as unknown as Promotion);
    em.persist(row);
    this.#audit(em, 'promotion.create', row.id, null, { name: row.name, code: row.code });
    await em.flush();
    await this.salesChannelMembership.bindToDefaultIfEmpty('promotion', row.id);
    return row;
  }

  /** Feature 045 — update an existing promotion by id (admin edit path). */
  async updateById(id: string, input: UpsertPromotionInput): Promise<Promotion> {
    const em = this.emFactory();
    const existing = await em.findOne(Promotion, { id });
    if (!existing) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Promotion ${id} not found.`);
    await this.validateUpsertInput(em, input, existing);
    Object.assign(existing, buildPromotionData(input));
    this.#audit(em, 'promotion.update', existing.id, null, { name: existing.name, code: existing.code });
    await em.flush();
    return existing;
  }

  private async validateUpsertInput(
    em: EntityManager,
    input: UpsertPromotionInput,
    existing: Promotion | null,
  ): Promise<void> {
    if (input.criteria) {
      await this.validateCriteria(input.criteria);
    }
    if (input.action && !this.actionRegistry.has(input.action.type)) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `unknown_promotion_action: ${input.action.type}`,
      );
    }
    if (input.ruleId) {
      const ruleRow = await em.findOne(PromotionRuleEntity, { id: input.ruleId });
      if (!ruleRow) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `rule_not_found: ${input.ruleId}`);
      }
    }
    if (input.currency != null) {
      await this.validateCurrency(
        input.currency,
        existing ? dispatchValidatorMode(existing.currency, input.currency) : 'create-or-change',
      );
    }
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Promotion, { id });
    if (!row) return;
    this.#audit(em, 'promotion.delete', row.id, { name: row.name, code: row.code }, null);
    await em.removeAndFlush(row);
  }

  private async validateCurrency(
    currency: string,
    mode: 'create-or-change' | 'unchanged',
  ): Promise<void> {
    try {
      await this.dictionaryValidator.validateCurrencyCode(currency, mode);
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw new HttpError(
          409,
          err.code,
          err.code === 'DICTIONARY_ENTRY_INACTIVE'
            ? `Currency code ${err.entryCode} is no longer available for promotions.`
            : `Currency code ${err.entryCode} is not recognised.`,
          [{ path: 'currency', issue: err.code }],
        );
      }
      throw err;
    }
  }

  async applyToCart(snapshot: CartSnapshot): Promise<PromotionApplication> {
    const em = this.emFactory();
    const now = new Date();

    const subtotal = round2(
      snapshot.lines.reduce(
        (acc, line) => acc + line.unitPrice.amount * line.quantity,
        0,
      ),
    );

    const all = await em.find(Promotion, { isActive: true });

    // Feature 045 (US3) — resolve a presented code through the coupon table
    // (legacy `promotions.code` gating is preserved below for back-compat).
    let couponMatch: { promotionId: string; couponId: string } | null = null;
    const couponedPromotionIds = new Set<string>();
    if (all.length > 0) {
      const coupons = await em.find(PromotionCoupon, {
        promotionId: { $in: all.map((p) => p.id) },
        isActive: true,
      });
      for (const c of coupons) couponedPromotionIds.add(c.promotionId);
      if (snapshot.promotionCode) {
        const match = coupons.find((c) => c.code === snapshot.promotionCode);
        if (match) couponMatch = { promotionId: match.promotionId, couponId: match.id };
      }
    }

    // Feature 026 US5 — when org-targeted promotions are present and the
    // snapshot carries an organizationId, resolve that org's status once.
    // Org-targeted promotions only apply if the org is `active`; `null` (org
    // missing or soft-deleted) skips them too. The resolver is required since
    // issue #251 — "no resolver wired, no gate" used to be a branch, and it
    // was the branch every helper-built service took.
    let orgStatusCheckResult: 'allow' | 'skip-org-targeted' = 'allow';
    if (snapshot.organizationId) {
      const hasOrgTargeted = all.some((p) => p.organizationId === snapshot.organizationId);
      if (hasOrgTargeted) {
        const status = await this.resolveOrganizationStatus(snapshot.organizationId);
        if (status !== 'active') {
          orgStatusCheckResult = 'skip-org-targeted';
        }
      }
    }

    // Feature 052 (US3) — sales-channel gate (FR-004 / FR-005). Resolve the set
    // of promotion ids bound to the cart's resolved channel and reject any
    // promotion whose `sales_channel_promotions` binding excludes it. The cart's
    // channel is `snapshot.salesChannelId`, which the cart→snapshot mappers always
    // populate explicitly (a uuid, or `null` when the cart resolved to no channel):
    //   - a uuid  → keep only promotions bound to that channel;
    //   - `null`  → the cart resolved to no channel → nothing matches (fail closed);
    //   - absent  → a legacy caller that does not participate in channel scoping →
    //               the gate is skipped (neutrality; every real caller sends the field).
    // The bridge is read only through SalesChannelMembershipService (Principle
    // XII's accessor clause, enforced by `check:module-boundary`'s `sql`
    // predicate since D-87). The accessor is required since issue #251: it used
    // to be optional, and "not wired ⇒ no channel filtering" is the shape
    // Principle XII exists to forbid. This is an interim predicate subsumed by
    // the future unified channel resolver (spec 03).
    let channelPromotionIds: Set<string> | null = null;
    if (all.length > 0 && snapshot.salesChannelId !== undefined) {
      if (snapshot.salesChannelId) {
        const ids = new Set<string>();
        const pageSize = 500;
        let page = 0;
        for (;;) {
          const { entityIds, total } = await this.salesChannelMembership.listEntityIdsForChannel(
            snapshot.salesChannelId,
            'promotion',
            page,
            pageSize,
          );
          for (const id of entityIds) ids.add(id);
          if (entityIds.length === 0 || ids.size >= total) break;
          page += 1;
        }
        channelPromotionIds = ids;
      } else {
        // Null / unresolved channel → nothing matches (fail closed, FR-005).
        channelPromotionIds = new Set<string>();
      }
    }

    let eligible = all.filter((p) => {
      if (channelPromotionIds && !channelPromotionIds.has(p.id)) return false;
      if (p.validFrom && now < p.validFrom) return false;
      if (p.validUntil && now > p.validUntil) return false;
      if (
        p.minCartSubtotal != null &&
        Number(p.minCartSubtotal) > subtotal
      ) {
        return false;
      }
      if (p.organizationId && p.organizationId !== snapshot.organizationId) return false;
      // Org-targeted promotions only fire for an active Organization.
      if (
        p.organizationId &&
        orgStatusCheckResult === 'skip-org-targeted'
      ) {
        return false;
      }
      if (p.customerGroupId && p.customerGroupId !== snapshot.customerGroupId) return false;
      // Legacy `promotions.code` gating.
      if (p.code) {
        if (!snapshot.promotionCode) return false;
        if (snapshot.promotionCode !== p.code) return false;
      }
      // Feature 045 (US3) — coupon-table gating: a promotion carrying coupons
      // applies only when the presented code resolves to one of its coupons.
      if (couponedPromotionIds.has(p.id) && couponMatch?.promotionId !== p.id) return false;
      return true;
    });

    // Feature 045 (US5) — soft-exclude promotions whose limits are already met
    // (best-effort; the atomic gate at placement is authoritative).
    const exhausted = await this.usageService.filterExhausted(eligible, {
      organizationId: snapshot.organizationId,
      customerAccountId: snapshot.customerAccountId ?? null,
    });
    if (exhausted.size > 0) eligible = eligible.filter((p) => !exhausted.has(p.id));

    // Feature 045 — apply in priority order (DESC) with deterministic
    // tie-break (createdAt ASC, then id). Coupon-presented promotions keep
    // their precedence within equal priority.
    eligible.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.code && !b.code) return -1;
      if (!a.code && b.code) return 1;
      const t = a.createdAt.getTime() - b.createdAt.getTime();
      if (t !== 0) return t;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    // Feature 012 / US8 + 045 — pre-build the per-key attribute lookup for
    // every attribute referenced by a promotion's criteria OR its rule.
    const referencedKeys = new Set<string>();
    for (const p of eligible) {
      for (const c of p.criteria) {
        if (c.type === 'attribute') referencedKeys.add(c.attributeKey);
      }
    }
    // Feature 045 — pre-load named rules referenced by eligible promotions.
    const ruleIds = [...new Set(eligible.map((p) => p.ruleId).filter((id): id is string => !!id))];
    const rulesById = new Map<string, PromotionRule>();
    if (ruleIds.length > 0) {
      const rows = await em.find(PromotionRuleEntity, { id: { $in: ruleIds } });
      for (const r of rows) rulesById.set(r.id, r.definition);
    }
    for (const p of eligible) {
      if (!p.actionType) continue;
      const rule = resolveRule(p, rulesById);
      for (const key of extractRuleAttributeKeys(rule)) referencedKeys.add(key);
    }
    const attributeLookup = await this.buildAttributeLookup([...referencedKeys]);

    // Hydrate per-line `attributeValues` for any referenced key.
    const hydratedSnapshot =
      referencedKeys.size === 0
        ? snapshot
        : await this.hydrateLineAttributeValues(snapshot, [...referencedKeys]);

    const ruleCtx = buildRuleContext(hydratedSnapshot, subtotal, attributeLookup, (info) =>
      this.auditLogger.info('promotion_rule_attribute_skipped', info),
    );

    let workingSubtotal = subtotal;
    let workingDelivery = snapshot.deliveryTotal;
    let discountTotal = 0;
    const applied: PromotionApplication['appliedPromotions'] = [];

    for (const promotion of eligible) {
      // Feature 045 — action-based promotion: evaluate the typed rule, then
      // run the configured action through the registry against running totals.
      if (promotion.actionType) {
        const rule = resolveRule(promotion, rulesById);
        if (!evaluatePromotionRule(rule, ruleCtx)) continue;
        const action = joinAction(promotion);
        if (!action) continue;
        const applyCtx: CartApplyContext = {
          lines: hydratedSnapshot.lines,
          subtotal: workingSubtotal,
          deliveryTotal: workingDelivery,
          currency: snapshot.currency,
        };
        const result = this.actionRegistry.apply(action, applyCtx);
        const subDelta = round2(Math.max(0, Math.min(result.discountSubtotalDelta, workingSubtotal)));
        const delDelta = round2(Math.max(0, Math.min(result.discountDeliveryDelta, workingDelivery)));
        const amount = round2(subDelta + delDelta);
        if (amount <= 0) continue;
        workingSubtotal = round2(workingSubtotal - subDelta);
        workingDelivery = round2(workingDelivery - delDelta);
        discountTotal = round2(discountTotal + amount);
        applied.push({
          promotionId: promotion.id,
          kind: null,
          actionType: promotion.actionType,
          couponId: couponMatch?.promotionId === promotion.id ? couponMatch.couponId : null,
          amount,
        });
        if (promotion.stopFurther) break;
        continue;
      }

      // Legacy kind/value promotion.
      const lineBase = this.computeLineBase(hydratedSnapshot, promotion, attributeLookup);
      if (lineBase <= 0 && promotion.kind !== 'free_delivery') continue;

      let amount = 0;
      if (promotion.kind === 'percentage_off') {
        amount = round2((lineBase * Number(promotion.value)) / 100);
      } else if (promotion.kind === 'amount_off') {
        if (promotion.currency && promotion.currency !== snapshot.currency) continue;
        amount = round2(Math.min(Number(promotion.value), lineBase));
      } else if (promotion.kind === 'free_delivery') {
        amount = round2(workingDelivery);
        workingDelivery = 0;
      }
      if (amount <= 0) continue;

      if (promotion.kind !== 'free_delivery') {
        workingSubtotal = Math.max(0, round2(workingSubtotal - amount));
      }
      discountTotal = round2(discountTotal + amount);
      applied.push({
        promotionId: promotion.id,
        kind: promotion.kind ?? null,
        actionType: null,
        couponId: couponMatch?.promotionId === promotion.id ? couponMatch.couponId : null,
        amount,
      });
      if (promotion.stopFurther) break;
    }

    const total = round2(workingSubtotal + workingDelivery);
    return {
      subtotal,
      discountTotal,
      deliveryTotal: workingDelivery,
      total,
      appliedPromotions: applied,
    };
  }

  /**
   * Feature 012 / US8 — validate a criteria array against the catalog
   * port. Throws `HttpError(400, ...)` for the documented error codes
   * (`attribute_not_found`, `attribute_not_promo_eligible`,
   * `invalid_criterion_op`, `invalid_criterion_values`,
   * `invalid_option_value`).
   */
  private async validateCriteria(criteria: PromotionCriterion[]): Promise<void> {
    for (const c of criteria) {
      if (c.type !== 'attribute') continue;
      const meta = await this.catalogPort.getAttributeWithOptions(c.attributeKey);
      if (!meta) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `attribute_not_found: ${c.attributeKey}`,
        );
      }
      if (!meta.isPromoRule) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `attribute_not_promo_eligible: ${c.attributeKey}`,
        );
      }
      const allowed = allowedOpsFor(meta.valueType);
      if (!allowed.includes(c.op)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `invalid_criterion_op: ${c.op} not in [${allowed.join(', ')}] for ${meta.valueType}`,
        );
      }
      validateValuesShape(c.op, c.values, meta.valueType);
      // Per-option-value membership for select-style attributes.
      if (meta.valueType === 'select' || meta.valueType === 'enum' || meta.valueType === 'multiselect') {
        const allowedValues = new Set(meta.options.map((o) => o.value));
        for (const v of c.values) {
          if (!allowedValues.has(String(v))) {
            throw new HttpError(
              400,
              ERROR_CODES.VALIDATION_FAILED,
              `invalid_option_value: ${String(v)}`,
            );
          }
        }
      }
    }
  }

  private async buildAttributeLookup(keys: string[]): Promise<PromotionRuleAttributeLookup> {
    const map = new Map<
      string,
      {
        id: string;
        key: string;
        valueType: AttributeValueType;
        isPromoRule: boolean;
        options: Array<{ value: string }>;
      }
    >();
    if (keys.length === 0) {
      return { get: (k) => map.get(k) ?? null };
    }
    for (const key of keys) {
      const meta = await this.catalogPort.getAttributeWithOptions(key);
      if (meta) {
        map.set(key, {
          id: meta.id,
          key: meta.key,
          valueType: meta.valueType,
          isPromoRule: meta.isPromoRule,
          options: meta.options.map((o) => ({ value: o.value })),
        });
      }
    }
    return { get: (k) => map.get(k) ?? null };
  }

  private async hydrateLineAttributeValues(
    snapshot: CartSnapshot,
    referencedKeys: string[],
  ): Promise<CartSnapshot> {
    const productIds = [
      ...new Set(
        snapshot.lines
          .filter((l) => !l.attributeValues)
          .map((l) => l.productId),
      ),
    ];
    if (productIds.length === 0) return snapshot;

    const products = await this.productReadPort.findByIds(productIds);
    const valuesByProductId = new Map<string, Record<string, unknown>>();
    for (const p of products) {
      const values = p.attributeValues ?? {};
      const subset: Record<string, unknown> = {};
      for (const k of referencedKeys) {
        if (k in values) subset[k] = values[k];
      }
      valuesByProductId.set(p.id, subset);
    }
    return {
      ...snapshot,
      lines: snapshot.lines.map((l) =>
        l.attributeValues
          ? l
          : { ...l, attributeValues: valuesByProductId.get(l.productId) ?? {} },
      ),
    };
  }

  private computeLineBase(
    snapshot: CartSnapshot,
    p: Promotion,
    attributeLookup: PromotionRuleAttributeLookup,
  ): number {
    // free_delivery doesn't read line totals.
    if (p.kind === 'free_delivery') return snapshot.deliveryTotal;

    const ctx: PromotionRuleEvaluationContext = {
      attributeLookup,
      promotionId: p.id,
      onSkip: ({ promotionId, criterionAttributeKey, reason }) => {
        this.auditLogger.info('promotion_criterion_skipped', {
          promotionId,
          criterionAttributeKey,
          reason,
        });
      },
    };

    return snapshot.lines.reduce((acc, line) => {
      if (p.productId && line.productId !== p.productId) return acc;
      if (p.categoryId && !line.categoryIds.includes(p.categoryId)) return acc;
      if (p.criteria.length > 0 && !lineMatchesAllCriteria(p.criteria, line, ctx)) return acc;
      return acc + line.unitPrice.amount * line.quantity;
    }, 0);
  }
}

function allowedOpsFor(
  valueType: AttributeValueType,
): Array<'equals' | 'in' | 'range'> {
  switch (valueType) {
    case 'string':
      return ['equals', 'in'];
    case 'select':
    case 'enum':
      return ['equals', 'in'];
    case 'multiselect':
      return ['in'];
    case 'number':
    case 'price':
      return ['equals', 'range'];
    case 'boolean':
      return ['equals'];
    case 'date':
      return ['equals', 'range'];
    default:
      return [];
  }
}

function validateValuesShape(
  op: 'equals' | 'in' | 'range',
  values: readonly unknown[],
  valueType: AttributeValueType,
): void {
  if (op === 'equals' && values.length !== 1) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      'invalid_criterion_values: equals expects a single-element values array',
    );
  }
  if (op === 'range') {
    if (values.length !== 2) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'invalid_criterion_values: range expects exactly [min, max]',
      );
    }
    const [min, max] = values;
    if (valueType === 'date') {
      if (!Number.isFinite(Date.parse(String(min))) || !Number.isFinite(Date.parse(String(max)))) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'invalid_criterion_values: range requires ISO date-time bounds',
        );
      }
    } else {
      if (!Number.isFinite(Number(min)) || !Number.isFinite(Number(max))) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'invalid_criterion_values: range requires numeric bounds',
        );
      }
    }
  }
  if (op === 'in' && values.length === 0) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      'invalid_criterion_values: in expects a non-empty values array',
    );
  }
  if (valueType === 'boolean' && op === 'equals') {
    if (typeof values[0] !== 'boolean') {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'invalid_criterion_values: boolean equals expects [true|false]',
      );
    }
  }
}


function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface UpsertPromotionInput {
  code?: string | null;
  name: string;
  kind?: 'percentage_off' | 'amount_off' | 'free_delivery';
  value?: number;
  currency?: string | null;
  minCartSubtotal?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  organizationId?: string | null;
  customerGroupId?: string | null;
  categoryId?: string | null;
  productId?: string | null;
  criteria?: PromotionCriterion[];
  isActive?: boolean;
  // Feature 045 — engine fields.
  description?: string | null;
  priority?: number;
  stopFurther?: boolean;
  action?: PromotionAction;
  ruleId?: string | null;
  rule?: PromotionRule | null;
  usageLimitGlobal?: number | null;
  usageLimitPerOrganization?: number | null;
  usageLimitPerCustomer?: number | null;
}

/** Map an upsert input into the entity-assignable data object. */
function buildPromotionData(input: UpsertPromotionInput): Record<string, unknown> {
  const { actionType, actionConfig } = splitAction(input.action);
  return {
    name: input.name,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.value !== undefined ? { value: String(input.value) } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.minCartSubtotal !== undefined && input.minCartSubtotal !== null
      ? { minCartSubtotal: String(input.minCartSubtotal) }
      : {}),
    ...(input.validFrom !== undefined
      ? { validFrom: input.validFrom ? new Date(input.validFrom) : null }
      : {}),
    ...(input.validUntil !== undefined
      ? { validUntil: input.validUntil ? new Date(input.validUntil) : null }
      : {}),
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
    ...(input.customerGroupId !== undefined ? { customerGroupId: input.customerGroupId } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.productId !== undefined ? { productId: input.productId } : {}),
    ...(input.criteria !== undefined ? { criteria: input.criteria } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.stopFurther !== undefined ? { stopFurther: input.stopFurther } : {}),
    ...(input.action !== undefined ? { actionType, actionConfig } : {}),
    // A rule source set clears the other (mutually exclusive).
    ...(input.ruleId !== undefined ? { ruleId: input.ruleId, ruleDefinition: null } : {}),
    ...(input.rule !== undefined ? { ruleDefinition: input.rule, ruleId: null } : {}),
    ...(input.usageLimitGlobal !== undefined ? { usageLimitGlobal: input.usageLimitGlobal } : {}),
    ...(input.usageLimitPerOrganization !== undefined
      ? { usageLimitPerOrganization: input.usageLimitPerOrganization }
      : {}),
    ...(input.usageLimitPerCustomer !== undefined
      ? { usageLimitPerCustomer: input.usageLimitPerCustomer }
      : {}),
  };
}

/** Split a `PromotionAction` union into the stored `(type, config)` pair. */
function splitAction(action?: PromotionAction): {
  actionType: PromotionAction['type'] | null;
  actionConfig: Record<string, unknown>;
} {
  if (!action) return { actionType: null, actionConfig: {} };
  const { type, ...config } = action;
  return { actionType: type, actionConfig: config };
}

/** Reconstruct a `PromotionAction` from the stored `(type, config)` pair. */
function joinAction(promotion: Promotion): PromotionAction | null {
  if (!promotion.actionType) return null;
  return { type: promotion.actionType, ...promotion.actionConfig } as PromotionAction;
}

/** Resolve a promotion's effective rule (inline, named, or match-all). */
function resolveRule(promotion: Promotion, rulesById: Map<string, PromotionRule>): PromotionRule {
  if (promotion.ruleDefinition) return promotion.ruleDefinition;
  if (promotion.ruleId) return rulesById.get(promotion.ruleId) ?? { kind: 'all' };
  return { kind: 'all' };
}

/** Collect attribute keys referenced anywhere in a rule tree. */
function extractRuleAttributeKeys(rule: PromotionRule): string[] {
  const keys: string[] = [];
  const walk = (node: PromotionRule): void => {
    if (node.kind === 'group') {
      node.children.forEach(walk);
    } else if (node.kind === 'condition' && node.field.kind === 'attribute') {
      keys.push(node.field.attributeKey);
    }
  };
  walk(rule);
  return keys;
}

function coerceRuleValue(v: unknown): string | number | boolean {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

/** Build the cart-level rule-evaluation context from a hydrated snapshot. */
function buildRuleContext(
  snapshot: CartSnapshot,
  subtotal: number,
  attributeLookup: PromotionRuleAttributeLookup,
  onSkip: (info: { attributeKey: string; reason: 'attribute_not_promo_eligible' }) => void,
): PromotionRuleContext {
  const attributeValues: Record<string, Array<string | number | boolean>> = {};
  for (const line of snapshot.lines) {
    const av = line.attributeValues ?? {};
    for (const [k, raw] of Object.entries(av)) {
      const bucket = (attributeValues[k] ??= []);
      if (Array.isArray(raw)) {
        for (const item of raw) bucket.push(coerceRuleValue(item));
      } else if (raw != null) {
        bucket.push(coerceRuleValue(raw));
      }
    }
  }
  const categoryIds = [...new Set(snapshot.lines.flatMap((l) => l.categoryIds))];
  return {
    cartTotal: subtotal,
    paymentMethodCode: snapshot.paymentMethodCode ?? null,
    deliveryMethodCode: snapshot.deliveryMethodCode ?? null,
    deliveryCountry: snapshot.deliveryCountry ?? null,
    deliveryPostalCode: snapshot.deliveryPostalCode ?? null,
    organizationId: snapshot.organizationId,
    customerGroupId: snapshot.customerGroupId,
    categoryIds,
    attributeValues,
    isPromoEligibleAttribute: (key) => attributeLookup.get(key)?.isPromoRule ?? false,
    onSkip,
  };
}
