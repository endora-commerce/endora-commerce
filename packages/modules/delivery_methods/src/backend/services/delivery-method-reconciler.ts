import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  DeliveryMethodSeedApi,
  DeliveryMethodSeedDefaults,
  DeliveryMethodSeedOutcome,
  DeliveryMethodSeedRecord,
} from '../../ports/index.js';
import { DeliveryMethod } from '../entities/delivery-method.entity.js';

/**
 * DeliveryMethodReconciler (feature 035, FR-002) — the implementation behind
 * `DeliveryMethodSeedApi`, this module's published install surface
 * (`../../ports/index.ts`, `createDeliveryMethodSeeder` below).
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
 * **The `EntityManager` is a parameter of every method and is never held**
 * (feature 134, FR-064; D-169). It used to be a constructor `emFactory`, which is
 * the shape of a service resolved from a container — and the caller this class
 * was written for has no container: `ModuleLifecycleContext` is
 * `{ em, redis, log, module }` and `module:install` composes nothing (D-46). The
 * hook's own `ctx.em` is therefore what every statement here runs on, handed in
 * at the call, so the write lands in the transaction the orchestrator will
 * commit or revert rather than on a fork of it.
 *
 * **It no longer rebinds sales-channel membership (issue #96)** — see the
 * payment twin (`payment_methods/services/payment-method-reconciler.ts`).
 * `bindToDefaultChannel` exists, and is the seed's own *once, for the rows it
 * creates* half rather than a reconcile: the caller guards it on
 * `created === true`. What issue #96 removed was the unconditional call, which
 * brought a method an operator had deliberately unbound from every channel back
 * to Default at the next boot, and nothing said so. "Unbound" is a state an
 * operator is entitled to reach and to keep.
 */
export class DeliveryMethodReconciler implements DeliveryMethodSeedApi {
  async ensureMethodForAdapter(
    em: EntityManager,
    adapterKey: string,
    defaults: DeliveryMethodSeedDefaults,
  ): Promise<DeliveryMethodSeedOutcome> {
    // command-coverage-ignore: idempotent reconciliation of adapter-backed delivery
    // methods — a system-invariant repair, not an operator-initiated write.
    const existing = await em.findOne(DeliveryMethod, { code: defaults.code });
    if (existing) {
      // Prune-safe: never clobber admin configuration. Only backfill a missing
      // adapter link (e.g. a legacy row predating this feature).
      if (!existing.adapter) {
        existing.adapter = adapterKey;
        await em.persistAndFlush(existing);
      }
      return { row: recordOf(existing), created: false };
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
   * for `'delivery-method'` and `bridges.require` would refuse (FR-017) before
   * the database was touched. `sales_channel_delivery_methods` is this module's
   * since `specs/120-migration-closure-bridge-ownership/` Phase 2 (D-226), so the
   * statement is the owner's own and crosses no boundary — which is what FR-064
   * buys by putting the writer here instead of in the seeding module.
   *
   * `em.execute` rather than `em.getConnection().execute`, so the statement runs
   * inside the caller's transaction (issue #200).
   */
  async bindToDefaultChannel(em: EntityManager, deliveryMethodId: string): Promise<boolean> {
    // command-coverage-ignore: install-time seed membership for a row this seam
    // just created — a system-invariant write with no request and no actor.
    const channels = await em.execute<Array<{ id: string }>>(
      'select "id" from "sales_channels" where "system_default" = true limit 1',
    );
    const defaultChannel = channels[0];
    if (!defaultChannel) {
      // A system-default channel always exists — the platform creates one at
      // install and exactly one row carries the flag (D-47…D-51). A "no channel"
      // branch here would silently skip the binding on an instance whose
      // invariant is broken, which is how a seeded method becomes unreachable
      // with nothing saying so.
      throw new Error(
        'delivery_methods: no system-default sales channel, so a seeded delivery method ' +
          'cannot be bound to one. The platform guarantees exactly one (D-47…D-51); this ' +
          'instance does not have it.',
      );
    }

    const inserted = await em.execute<Array<{ delivery_method_id: string }>>(
      'insert into "sales_channel_delivery_methods" ("sales_channel_id", "delivery_method_id") ' +
        'values (?, ?) on conflict ("sales_channel_id", "delivery_method_id") do nothing ' +
        'returning "delivery_method_id"',
      [defaultChannel.id, deliveryMethodId],
    );
    return inserted.length > 0;
  }

  /**
   * The hard-uninstall half. Channel memberships go with the row: the bridge's
   * foreign key onto `delivery_methods` is `on delete cascade`.
   */
  async removeMethodForAdapter(em: EntityManager, code: string): Promise<boolean> {
    // command-coverage-ignore: hard-uninstall removal of an adapter-backed
    // delivery method — no request, no actor and nothing to attribute an audit
    // entry to; the operator path is `commands/delivery-method.commands.ts`.
    const removed = await em.nativeDelete(DeliveryMethod, { code });
    return removed > 0;
  }
}

/**
 * The published record, mapped field by field rather than by handing the entity
 * back (D-168/D-77): a caller reads values off it and cannot persist through it.
 */
function recordOf(row: DeliveryMethod): DeliveryMethodSeedRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    cost: row.cost,
    currency: row.currency,
    status: row.status,
    adapter: row.adapter,
    statusOnSuccess: row.statusOnSuccess,
    statusOnFailure: row.statusOnFailure,
  };
}

/**
 * The runtime half of this module's install surface (feature 134, FR-064).
 *
 * A seeding module's `installHook` writes `createDeliveryMethodSeeder()` and
 * hands `ctx.em` to each call. The factory takes no arguments because the `em`
 * belongs to the call and not to the seeder: one `em`, named at every statement,
 * with no second source of truth for which transaction the write lands in.
 */
export function createDeliveryMethodSeeder(): DeliveryMethodSeedApi {
  return new DeliveryMethodReconciler();
}
