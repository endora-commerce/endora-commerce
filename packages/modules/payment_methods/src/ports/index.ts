/**
 * The install-time seed surface `payment_methods` publishes, and **nothing that
 * exists at runtime** (feature 134, FR-064; D-168, D-169, D-171).
 *
 * The delivery twin — `packages/modules/delivery_methods/src/ports/index.ts` —
 * is the same decision taken one wave earlier, and its doc-block carries the
 * full argument. **Wave 2 reuses that decision rather than retaking it**
 * (`contracts/foreign-write-repair.md` §2, §8 item 2h); what is written here is
 * what differs, and the differences are two: this seam's row carries a `kind`
 * the delivery one has no equivalent of, and five modules adopt it instead of
 * two.
 *
 * `tsc` compiles this file to `export {};`. That is the property D-171 makes the
 * boundary decision on — *a subpath is contract surface iff the module it
 * resolves to exports no runtime binding* — so a consumer naming this subpath
 * names a declaration and can name nothing else. The runtime half is one
 * factory, `createPaymentMethodSeeder`, on this package's `./install`.
 *
 * ## Why this interface exists at all, and why it is here rather than in
 * `packages/contracts`
 *
 * A module that ships its own gateway rows used to seed them with an `insert`
 * into this module's table from its own migration — `autopay`, `paypal`, `payu`,
 * `stripe` and `tpay` each did, which is fifteen `migration-foreign-writes`
 * ledger keys and, **once a seeding module ships separately from the table's
 * owner**, a hard schema dependency with no version range and no compile-time
 * signal at all. That is the whole of the reason, and it holds for any pair of
 * modules published from two places rather than for these five: an `insert` into
 * a table another package owns is a dependency on that table's *shape*, and npm
 * has no way to express one. The repair is that the seed is issued from the
 * seeding module's `installHook` through this surface — **R11 / D-251 /
 * FR-064**, the criterion any module may satisfy.
 *
 * It cannot live in `@endora-commerce/contracts`: every method takes a MikroORM
 * `EntityManager`, that package is compiled by `admin` and `storefront`, and
 * FR-034 keeps it free of `@mikro-orm` imports. That is exactly D-171's
 * qualifying test — *does this signature stop the interface living in
 * `packages/contracts`* — and it is why the `em` is a **required** first
 * parameter on every method and never an optional one (D-169): an optional
 * transactional `em` lets a caller hand a transaction to an implementation that
 * ignores it and receive a silently non-atomic write.
 *
 * ## It carries no `Container name:` marker, deliberately
 *
 * This is not a container port and must not read as one. `ModuleLifecycleContext`
 * is `{ em, redis, log, module }`, both orchestrator construction sites pass no
 * container, and D-46 deleted `ctx.onInstall` because `module:install` composes
 * nothing — so there is no cradle for a hook to resolve a name from, `lazyPort`
 * is structurally unavailable here, and a documented container name would be a
 * name nothing registers (`check:port-shape`'s signal 2, from the other side).
 * The consumer's seam is the factory, not a resolution.
 *
 * ## No entity leaves by this door (D-168)
 *
 * {@link PaymentMethodSeedRecord} is a published record and not the
 * `PaymentMethod` entity, type-only included. Handing a caller a managed entity
 * hands it the ability to mutate a payment method outside the seam, and to
 * persist that change on whichever transaction it happens to hold.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentAdapterType } from '@endora-commerce/contracts';

/** The row values a seeding module supplies for its own payment method. */
export interface PaymentMethodSeedDefaults {
  /** Unique within `payment_methods`; the seam's whole idempotence rests on it. */
  code: string;
  /**
   * Which driver realises the method — `'gateway'` for all five wave-2 vendors.
   * The delivery twin has no equivalent field, which is the one shape difference
   * between the two seams.
   */
  type: PaymentAdapterType;
  /** Translations by language tag, with a `default` key. */
  name: Record<string, string>;
  additionalPrice?: string;
  /**
   * `'active'` when omitted. **Pass it explicitly when the module wants anything
   * else**: all five gateway seeds wrote `'inactive'`, and taking the default
   * there would offer a payment method at checkout that no operator chose
   * (`contracts/foreign-write-repair.md` §2.4).
   */
  status?: 'active' | 'inactive';
  statusOnPending?: string;
  statusOnSuccess?: string;
  /**
   * `'on_hold'` when omitted, which is feature 085 FR-003's shipped default and
   * the value every caller wants.
   *
   * **Never pass `'cancelled'`.** `cancelled` is terminal, so a declined payment
   * destroys the order the buyer was trying to pay for; the five
   * `*_failure_status_on_hold` migrations exist only to undo rows the old seeds
   * wrote with it, and they retire with no replacement precisely because this
   * default means a fresh install can no longer produce one
   * (`contracts/foreign-write-repair.md` §4).
   */
  statusOnFailure?: string;
}

/** What the seam answers about a payment method — a record, never the entity. */
export interface PaymentMethodSeedRecord {
  readonly id: string;
  readonly code: string;
  readonly name: Record<string, string>;
  readonly kind: PaymentAdapterType;
  readonly adapter: string;
  readonly status: 'active' | 'inactive';
  readonly additionalPrice: string;
  readonly statusOnPending: string;
  readonly statusOnSuccess: string;
  readonly statusOnFailure: string;
}

/**
 * Created-versus-found, which the caller needs and cannot derive.
 *
 * `created` is what a channel binding is guarded on: the seed binds **once, for
 * the rows it creates**, and re-binding a method an operator deliberately
 * unbound from every channel is issue #96 verbatim
 * (`contracts/foreign-write-repair.md` §2.3).
 */
export interface PaymentMethodSeedOutcome {
  readonly row: PaymentMethodSeedRecord;
  readonly created: boolean;
}

export interface PaymentMethodSeedApi {
  /**
   * Create this module's payment-method row, or return the existing one
   * untouched. Idempotent and prune-safe: a row matched by `code` keeps its
   * admin-edited configuration and only a missing `adapter` link is backfilled.
   */
  ensureMethodForAdapter(
    em: EntityManager,
    adapterKey: string,
    defaults: PaymentMethodSeedDefaults,
  ): Promise<PaymentMethodSeedOutcome>;

  /**
   * Put the method in the system-default sales channel.
   *
   * **Call it only when `ensureMethodForAdapter` answered `created === true`.**
   * Never as a reconcile: "unbound from every channel" is a state an operator is
   * entitled to reach and to keep, and an unguarded call brings the method back
   * with nothing saying so (issue #96).
   *
   * Answers whether a membership row was written — `false` when the method was
   * already in that channel, and `false` when the platform has **no**
   * system-default channel yet, which a database that has been migrated and never
   * booted does not: the default channel is created at boot, and an install
   * composes nothing. The row is then seeded and unbound, which is what the seed
   * migration this replaced did in the same state.
   */
  bindToDefaultChannel(em: EntityManager, paymentMethodId: string): Promise<boolean>;

  /**
   * Remove the method and, by cascade, its channel memberships and every
   * vendor-owned row keyed on it.
   *
   * For a **hard** uninstall only (`if (!ctx.hard) return;`). A soft uninstall
   * and a deactivation both keep the row: the registry filters the adapter's
   * enumeration by its contributing module's effective state, so an off module
   * is answered at the read and the operator's edits survive being switched back
   * on (Principle XVII). Answers whether a row was removed.
   */
  removeMethodForAdapter(em: EntityManager, code: string): Promise<boolean>;
}
