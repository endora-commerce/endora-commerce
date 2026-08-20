import type { EntityManager } from '@mikro-orm/postgresql';
import { DeliveryMethod } from '../entities/delivery-method.entity.js';

/**
 * DeliveryMethodReconciler (feature 035, FR-002).
 *
 * A module that must create its `delivery_methods` row from code calls
 * `ensureMethodForAdapter` from its **install hook**, so installing a
 * shipping-method module surfaces a configurable entry at `/delivery-methods`
 * with no core change. Idempotent and prune-safe: an existing row (matched by
 * `code`) keeps its admin-edited configuration; the reconciler only fills a
 * missing `adapter` link.
 *
 * The row and the adapter are contributed at **different moments, on purpose**.
 * This row is durable state and is written once, at install; the adapter is an
 * in-memory entry in a per-process table and is pushed from the contributing
 * module's boot hook, on every composition (see `shipping-adapter-registry.ts`).
 * Neither waits for the other: a row whose `adapter` key nothing has contributed
 * is simply not offered, and the registry is not read until a request reads it.
 *
 * **It no longer touches sales-channel membership (issue #96)** — see the
 * payment twin (`payment_methods/services/payment-method-reconciler.ts`).
 * The mechanism was identical here; only the exposure differed, because no
 * carrier module contributes an adapter yet. Removing it before one does is
 * the point.
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
  constructor(private readonly emFactory: () => EntityManager) {}

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
    return row;
  }
}
