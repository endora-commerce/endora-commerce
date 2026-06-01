import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentAdapterType } from '@b2b/contracts';
import { PaymentMethod } from '../entities/payment-method.entity.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';

/**
 * PaymentMethodReconciler (feature 034, FR-002).
 *
 * When a module registers a payment adapter (from its lifecycle install hook),
 * it calls `ensureMethodForAdapter` to create a configurable `payment_methods`
 * row bound to that adapter — so enabling a payment-method module surfaces an
 * entry at `/payment-methods` with no core change. Idempotent and prune-safe:
 * an existing row (matched by `code`) keeps its admin-edited configuration; the
 * reconciler only fills a missing `adapter` link.
 */
export interface EnsureMethodDefaults {
  code: string;
  type: PaymentAdapterType;
  name: Record<string, string>;
  additionalPrice?: string;
  status?: 'active' | 'inactive';
  statusOnPending?: string;
  statusOnSuccess?: string;
  statusOnFailure?: string;
}

export class PaymentMethodReconciler {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly salesChannelMembership?: SalesChannelMembershipService,
  ) {}

  async ensureMethodForAdapter(
    adapterKey: string,
    defaults: EnsureMethodDefaults,
  ): Promise<PaymentMethod> {
    const em = this.emFactory();
    const existing = await em.findOne(PaymentMethod, { code: defaults.code });
    if (existing) {
      // Prune-safe: never clobber admin configuration. Only backfill a
      // missing adapter link (e.g. a legacy row predating this feature).
      if (!existing.adapter) {
        existing.adapter = adapterKey;
        await em.persistAndFlush(existing);
      }
      return existing;
    }

    const row = em.create(PaymentMethod, {
      code: defaults.code,
      name: defaults.name,
      kind: defaults.type,
      adapter: adapterKey,
      status: defaults.status ?? 'active',
      additionalPrice: defaults.additionalPrice ?? '0',
      statusOnPending: defaults.statusOnPending ?? 'new',
      statusOnSuccess: defaults.statusOnSuccess ?? 'paid',
      statusOnFailure: defaults.statusOnFailure ?? 'cancelled',
    });
    await em.persistAndFlush(row);

    // Bind to the system-default sales channel when no membership exists yet,
    // matching the behaviour of the existing admin upsert path.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('payment-method', row.id);
    }
    return row;
  }
}
