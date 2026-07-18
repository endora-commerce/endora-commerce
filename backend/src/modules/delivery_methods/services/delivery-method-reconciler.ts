import type { EntityManager } from '@mikro-orm/postgresql';
import { DeliveryMethod } from '../entities/delivery-method.entity.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';

/**
 * DeliveryMethodReconciler (feature 035, FR-002).
 *
 * When a module registers a shipping adapter (from its lifecycle install hook),
 * it calls `ensureMethodForAdapter` to create a configurable `delivery_methods`
 * row bound to that adapter — so enabling a shipping-method module surfaces an
 * entry at `/delivery-methods` with no core change. Idempotent and prune-safe:
 * an existing row (matched by `code`) keeps its admin-edited configuration; the
 * reconciler only fills a missing `adapter` link.
 */
export interface EnsureMethodDefaults {
  code: string;
  name: Record<string, string>;
  cost?: string;
  currency?: string;
  status?: 'active' | 'inactive';
  statusOnSuccess?: string;
  statusOnFailure?: string;
}

export class DeliveryMethodReconciler {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly salesChannelMembership?: SalesChannelMembershipService,
  ) {}

  async ensureMethodForAdapter(
    adapterKey: string,
    defaults: EnsureMethodDefaults,
  ): Promise<DeliveryMethod> {
    // command-coverage-ignore: idempotent reconciliation of adapter-backed delivery
    // methods — a system-invariant repair, not an operator-initiated write.
    const em = this.emFactory();
    const existing = await em.findOne(DeliveryMethod, { code: defaults.code });
    if (existing) {
      // Prune-safe: never clobber admin configuration. Only backfill a missing
      // adapter link (e.g. a legacy row predating this feature).
      if (!existing.adapter) {
        existing.adapter = adapterKey;
        await em.persistAndFlush(existing);
      }
      return existing;
    }

    const row = em.create(DeliveryMethod, {
      code: defaults.code,
      name: defaults.name,
      adapter: adapterKey,
      cost: defaults.cost ?? '0',
      currency: defaults.currency ?? 'PLN',
      status: defaults.status ?? 'active',
      statusOnSuccess: defaults.statusOnSuccess ?? 'shipment_sent',
      statusOnFailure: defaults.statusOnFailure ?? 'processing',
    });
    await em.persistAndFlush(row);

    // Bind to the system-default sales channel when no membership exists yet,
    // matching the behaviour of the existing admin upsert path.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('delivery-method', row.id);
    }
    return row;
  }
}
