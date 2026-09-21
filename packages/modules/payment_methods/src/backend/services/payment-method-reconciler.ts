import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '@endora-commerce/platform/kernel';
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
 * **It no longer touches sales-channel membership unconditionally (issue #96).**
 * It used to call `bindToDefaultIfEmpty` for every row it created, and the four
 * gateway modules called it from their plugin body on every composition — so a
 * method an operator had deliberately unbound from every channel came back bound
 * to Default at the next boot, and nothing said so. Binding belongs to the two
 * seams that own the decision: the admin create path (a method an operator just
 * created has to land somewhere) and the module's own seed (once, for the rows it
 * creates). `bindToDefaultChannel` below is that second seam, and the caller
 * guards it on `created === true`. "Unbound" is a state an operator is entitled
 * to reach and to keep.
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
   * The seed's channel binding — one membership row in the system-default
   * channel, written against **this module's own** bridge table.
   *
   * Not through `SalesChannelMembershipService`, and the reason is structural
   * rather than a preference: that service needs the `EventBus`, the audit port
   * and the channel-bridge registry, and the registry is contributed from a boot
   * hook. An install composes nothing, so at this seam it holds no registration
   * for `'payment-method'` and `bridges.require` would refuse (FR-017) before the
   * database was touched. `sales_channel_payment_methods` is this module's since
   * `specs/120-migration-closure-bridge-ownership/` Phase 2 (D-226), so the
   * statement is the owner's own and crosses no boundary — which is what FR-064
   * buys by putting the writer here instead of in the seeding module.
   *
   * The channel itself is read through the kernel's own `SalesChannel` entity
   * rather than in SQL — `api_keys` reads it the same way — because a raw
   * `select … from "sales_channels"` from a module is a `check:module-boundary`
   * finding against a kernel-owned table, and correctly so: the table is not
   * this module's and the entity is the platform's published name for it.
   *
   * `em.execute` for the insert rather than `em.getConnection().execute`, so the
   * statement runs inside the caller's transaction (issue #200). The bridge has
   * no entity class — the kernel's membership service writes it in SQL too.
   *
   * **No system-default channel answers `false` rather than raising**, exactly as
   * the delivery twin does and for the same measured reason: the default channel
   * is created by `DefaultChannelReconciler` at **boot**, from `composeApp`, and
   * `module:install` composes nothing (D-46), so a database that has been migrated
   * and never booted has none. The seed migration this replaced degraded the same
   * way, silently — its `cross join "sales_channels" where "system_default"`
   * produced no rows and inserted no membership — so answering `false` is what
   * keeps a fresh install and an upgraded one at the same row state in that state
   * too. Raising instead **aborts the install**, and the hook is not inside a
   * database transaction.
   */
  async bindToDefaultChannel(em: EntityManager, paymentMethodId: string): Promise<boolean> {
    // command-coverage-ignore: install-time seed membership for a row this seam
    // just created — a system-invariant write with no request and no actor.
    const defaultChannel = await em.findOne(SalesChannel, { systemDefault: true });
    if (!defaultChannel) return false;

    const inserted = await em.execute<Array<{ payment_method_id: string }>>(
      'insert into "sales_channel_payment_methods" ("sales_channel_id", "payment_method_id") ' +
        'values (?, ?) on conflict ("sales_channel_id", "payment_method_id") do nothing ' +
        'returning "payment_method_id"',
      [defaultChannel.id, paymentMethodId],
    );
    return inserted.length > 0;
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
