import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  PaymentMethodSeedApi,
  PaymentMethodSeedDefaults,
  PaymentMethodSeedOutcome,
  PaymentMethodSeedRecord,
} from '../../ports/index.js';
import { PaymentMethod } from '../entities/payment-method.entity.js';

/**
 * PaymentMethodReconciler (feature 034, FR-002) — the implementation behind
 * `PaymentMethodSeedApi`, this module's published install surface
 * (`../../ports/index.ts`, `createPaymentMethodSeeder` below).
 *
 * When a module contributes a payment adapter, it calls `ensureMethodForAdapter`
 * from its **install hook** to create a configurable `payment_methods` row bound
 * to that adapter — so installing a payment-method module surfaces an entry at
 * `/payment-methods` with no core change. Idempotent and prune-safe: an existing
 * row (matched by `code`) keeps its admin-edited configuration; the reconciler
 * only fills a missing `adapter` link.
 *
 * The row and the adapter are contributed at **different moments, on purpose**.
 * This row is durable state and is written once, at install; the adapter is an
 * in-memory entry in a per-process table and is pushed from the contributing
 * module's boot hook, on every composition (see `payment-adapter-registry.ts`).
 * Neither waits for the other: a row whose `adapter` key nothing has contributed
 * is simply not offered, and the registry is not read until a request reads it.
 *
 * **The `EntityManager` is a parameter of every method and is never held**
 * (feature 134, FR-064; D-169). It used to be a constructor `emFactory`, which is
 * the shape of a service resolved from a container — and the caller this class
 * was written for has no container: `ModuleLifecycleContext` is
 * `{ em, redis, log, module }` and `module:install` composes nothing (D-46). The
 * hook's own `ctx.em` is therefore what every statement here runs on, handed in
 * at the call, so the write lands in the transaction the orchestrator will
 * commit or revert rather than on a fork of it.
 *
 * **It writes no sales-channel membership at all.** A seeded method is left
 * bound to no channel, and for this entity type that is a meaning rather than
 * a gap: a membership is a restriction, and a method nobody restricted is
 * offered in every channel (`./channel-availability.ts`).
 *
 * It took two steps to get here. The reconciler first bound every row it
 * created to the default channel on every composition, which brought a method
 * an operator had deliberately unbound back to Default at the next boot
 * (issue #96). The bind then became a separate `bindToDefaultChannel`, called
 * by the seeding module once, for a row it had just created — and it bound
 * only when a default channel already existed, so the same module seeded a
 * method "everywhere" on a database that had never booted and "Default only" on
 * one that had. That method is gone (owner ruling, with the per-channel
 * availability feature): whenever a module is installed, its method is offered
 * on every channel until an operator restricts it.
 *
 * Rows an earlier release bound are **not** touched — a membership it wrote
 * cannot be told apart from an operator's deliberate "default only", so
 * `ensureMethodForAdapter` leaves the memberships of a row it finds exactly as
 * they are.
 */
export class PaymentMethodReconciler implements PaymentMethodSeedApi {
  async ensureMethodForAdapter(
    em: EntityManager,
    adapterKey: string,
    defaults: PaymentMethodSeedDefaults,
  ): Promise<PaymentMethodSeedOutcome> {
    // command-coverage-ignore: idempotent reconciliation of adapter-backed payment
    // methods — a system-invariant repair, not an operator-initiated write.
    const existing = await em.findOne(PaymentMethod, { code: defaults.code });
    if (existing) {
      // Prune-safe: never clobber admin configuration. Only backfill a
      // missing adapter link (e.g. a legacy row predating this feature).
      if (!existing.adapter) {
        existing.adapter = adapterKey;
        await em.persistAndFlush(existing);
      }
      return { row: recordOf(existing), created: false };
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
      // Feature 085 (FR-003) — see the twin default in
      // `commands/payment-method.commands.ts`. It is also what retires the five
      // `*_failure_status_on_hold` migrations with no replacement: a fresh
      // install through this seam can no longer produce the `'cancelled'` they
      // exist to correct (`contracts/foreign-write-repair.md` §4).
      statusOnFailure: defaults.statusOnFailure ?? 'on_hold',
    });
    await em.persistAndFlush(row);
    return { row: recordOf(row), created: true };
  }

  /**
   * The hard-uninstall half. Channel memberships go with the row, and so does
   * every vendor-owned row keyed on it — each gateway's
   * `*_payment_method_rules` and `*_payment_method_org_disables` declare
   * `references "payment_methods" ("id") on delete cascade`.
   */
  async removeMethodForAdapter(em: EntityManager, code: string): Promise<boolean> {
    // command-coverage-ignore: hard-uninstall removal of an adapter-backed
    // payment method — no request, no actor and nothing to attribute an audit
    // entry to; the operator path is `commands/payment-method.commands.ts`.
    const removed = await em.nativeDelete(PaymentMethod, { code });
    return removed > 0;
  }
}

/**
 * The published record, mapped field by field rather than by handing the entity
 * back (D-168/D-77): a caller reads values off it and cannot persist through it.
 */
function recordOf(row: PaymentMethod): PaymentMethodSeedRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    adapter: row.adapter,
    status: row.status,
    additionalPrice: row.additionalPrice,
    statusOnPending: row.statusOnPending,
    statusOnSuccess: row.statusOnSuccess,
    statusOnFailure: row.statusOnFailure,
  };
}

/**
 * The runtime half of this module's install surface (feature 134, FR-064).
 *
 * A seeding module's `installHook` writes `createPaymentMethodSeeder()` and hands
 * `ctx.em` to each call. The factory takes no arguments because the `em` belongs
 * to the call and not to the seeder: one `em`, named at every statement, with no
 * second source of truth for which transaction the write lands in.
 */
export function createPaymentMethodSeeder(): PaymentMethodSeedApi {
  return new PaymentMethodReconciler();
}
