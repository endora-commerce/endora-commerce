import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentAdapterType } from '@b2b/contracts';
import { PaymentMethod } from '../entities/payment-method.entity.js';

/**
 * PaymentMethodReconciler (feature 034, FR-002).
 *
 * When a module contributes a payment adapter, it calls
 * `ensureMethodForAdapter` from its `installHook` to create a configurable
 * `payment_methods` row bound to that adapter — so installing a payment-method
 * module surfaces an entry at `/payment-methods` with no core change. Idempotent
 * and prune-safe: an existing row (matched by `code`) keeps its admin-edited
 * configuration; the reconciler only fills a missing `adapter` link.
 *
 * **It no longer touches sales-channel membership (issue #96).** It used to call
 * `bindToDefaultIfEmpty` for every row it created, and the four gateway modules
 * called it from their plugin body on every composition — so a method an
 * operator had deliberately unbound from every channel came back bound to
 * Default at the next boot, and nothing said so. Binding belongs to the two
 * seams that own the decision: the admin create path (a method an operator just
 * created has to land somewhere) and the module's own seed migration (once, for
 * the rows it creates). "Unbound" is a state an operator is entitled to reach
 * and to keep.
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
  constructor(private readonly emFactory: () => EntityManager) {}

  async ensureMethodForAdapter(
    adapterKey: string,
    defaults: EnsureMethodDefaults,
  ): Promise<PaymentMethod> {
    // command-coverage-ignore: idempotent reconciliation of adapter-backed payment
    // methods — a system-invariant repair, not an operator-initiated write.
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
    return row;
  }
}
