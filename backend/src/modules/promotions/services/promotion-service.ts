import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  type CartSnapshot,
  type DictionaryValidator,
  type PromotionApplication,
  type PromotionCriterion,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { dispatchValidatorMode } from '../../dictionaries/services/dispatch-validator-mode.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';
import { Promotion } from '../entities/promotion.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import type { ProductAttribute } from '../../catalog/entities/product-attribute.entity.js';
import {
  lineMatchesAllCriteria,
  type PromotionRuleAttributeLookup,
  type PromotionRuleEvaluationContext,
} from './promotion-rule-service.js';

/**
 * Cross-module port for fetching promotion-rule attribute metadata. The
 * `CatalogQueryService` from feature 012 / US8 satisfies this shape;
 * tests + the composition root pass it in through the constructor.
 */
export interface PromotionRuleCatalogPort {
  getAttributeWithOptions(key: string): Promise<{
    id: string;
    key: string;
    valueType: ProductAttribute['valueType'];
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
    /** Feature 005 / T027b — auto-bind newly-created Promotions to the system default. */
    private readonly salesChannelMembership?: SalesChannelMembershipService,
    /**
     * Feature 012 / US8 — cross-module read port (CatalogQueryService).
     * When omitted, attribute-criteria short-circuit to `false` so legacy
     * tests / composition setups that don't wire this stay green.
     */
    private readonly catalogPort?: PromotionRuleCatalogPort,
    private readonly dictionaryValidator?: DictionaryValidator,
    /** Feature 012 / US8 — audit sink for FR-039 skip-on-toggle events. */
    private readonly auditLogger: PromotionAuditLogger = {
      info: (message, fields) => console.warn(`[audit] ${message}`, fields ?? {}),
    },
  ) {}

  async list(): Promise<Promotion[]> {
    return this.emFactory().find(Promotion, {}, { orderBy: { name: 'asc' } });
  }

  async getById(id: string): Promise<Promotion> {
    const row = await this.emFactory().findOne(Promotion, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Promotion ${id} not found.`);
    return row;
  }

  async upsert(input: {
    code?: string | null;
    name: string;
    kind: 'percentage_off' | 'amount_off' | 'free_delivery';
    value: number;
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
  }): Promise<Promotion> {
    if (input.criteria) {
      await this.validateCriteria(input.criteria);
    }
    const em = this.emFactory();
    const existing = input.code
      ? await em.findOne(Promotion, { code: input.code })
      : null;
    if (input.currency != null) {
      await this.validateCurrency(
        input.currency,
        existing ? dispatchValidatorMode(existing.currency, input.currency) : 'create-or-change',
      );
    }
    const data = {
      name: input.name,
      kind: input.kind,
      value: String(input.value),
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
    };
    if (existing) {
      Object.assign(existing, data);
      await em.flush();
      return existing;
    }
    const row = em.create(Promotion, data);
    await em.persistAndFlush(row);
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('promotion', row.id);
    }
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Promotion, { id });
    if (!row) return;
    await em.removeAndFlush(row);
  }

  private async validateCurrency(
    currency: string,
    mode: 'create-or-change' | 'unchanged',
  ): Promise<void> {
    if (!this.dictionaryValidator) return;
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
    const eligible = all.filter((p) => {
      if (p.validFrom && now < p.validFrom) return false;
      if (p.validUntil && now > p.validUntil) return false;
      if (
        p.minCartSubtotal != null &&
        Number(p.minCartSubtotal) > subtotal
      ) {
        return false;
      }
      if (p.organizationId && p.organizationId !== snapshot.organizationId) return false;
      if (p.customerGroupId && p.customerGroupId !== snapshot.customerGroupId) return false;
      if (p.code) {
        if (!snapshot.promotionCode) return false;
        if (snapshot.promotionCode !== p.code) return false;
      }
      return true;
    });

    // Coupon presented promotions first so they always trump automatics.
    eligible.sort((a, b) => {
      if (a.code && !b.code) return -1;
      if (!a.code && b.code) return 1;
      return Number(b.value) - Number(a.value);
    });

    // Feature 012 / US8 — pre-build the per-key attribute lookup for
    // every attribute referenced by an active promotion's criteria.
    const referencedKeys = new Set<string>();
    for (const p of eligible) {
      for (const c of p.criteria) {
        if (c.type === 'attribute') referencedKeys.add(c.attributeKey);
      }
    }
    const attributeLookup = await this.buildAttributeLookup([...referencedKeys]);

    // Feature 012 / US8 — hydrate per-line `attributeValues` snapshots
    // for any line whose product is referenced by a criterion. Callers
    // MAY pre-populate the snapshot themselves; if so, we skip the
    // round-trip.
    const hydratedSnapshot =
      referencedKeys.size === 0
        ? snapshot
        : await this.hydrateLineAttributeValues(snapshot, [...referencedKeys]);

    let workingSubtotal = subtotal;
    let workingDelivery = snapshot.deliveryTotal;
    let discountTotal = 0;
    const applied: PromotionApplication['appliedPromotions'] = [];

    for (const promotion of eligible) {
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
      applied.push({ promotionId: promotion.id, kind: promotion.kind, amount });
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
    if (!this.catalogPort) {
      // Without the port we can only structurally validate (already done
      // by the Zod schema); skip the semantic per-valueType checks.
      return;
    }
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
        valueType: ProductAttribute['valueType'];
        isPromoRule: boolean;
        options: Array<{ value: string }>;
      }
    >();
    if (!this.catalogPort || keys.length === 0) {
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

    const em = this.emFactory();
    const products = await em.find(Product, { id: { $in: productIds } });
    const valuesByProductId = new Map<string, Record<string, unknown>>();
    for (const p of products) {
      const values = (p.attributeValues ?? {}) as Record<string, unknown>;
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
  valueType: ProductAttribute['valueType'],
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
  valueType: ProductAttribute['valueType'],
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
