import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CartSnapshot,
  type PromotionApplication,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';
import { Promotion } from '../entities/promotion.entity.js';

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
    isActive?: boolean;
  }): Promise<Promotion> {
    const em = this.emFactory();
    const existing = input.code
      ? await em.findOne(Promotion, { code: input.code })
      : null;
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

    let workingSubtotal = subtotal;
    let workingDelivery = snapshot.deliveryTotal;
    let discountTotal = 0;
    const applied: PromotionApplication['appliedPromotions'] = [];

    for (const promotion of eligible) {
      const lineBase = computeLineBase(snapshot, promotion);
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
}

function computeLineBase(snapshot: CartSnapshot, p: Promotion): number {
  // free_delivery doesn't read line totals.
  if (p.kind === 'free_delivery') return snapshot.deliveryTotal;
  // Scoped to a single category or product: only matching lines.
  if (p.productId || p.categoryId) {
    return snapshot.lines.reduce((acc, line) => {
      if (p.productId && line.productId !== p.productId) return acc;
      if (p.categoryId && !line.categoryIds.includes(p.categoryId)) return acc;
      return acc + line.unitPrice.amount * line.quantity;
    }, 0);
  }
  return snapshot.lines.reduce(
    (acc, line) => acc + line.unitPrice.amount * line.quantity,
    0,
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
