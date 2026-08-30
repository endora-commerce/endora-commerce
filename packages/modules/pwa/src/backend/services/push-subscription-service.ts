import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, PushSubscriptionInput } from '@endora-commerce/contracts';
import { PushSubscription } from '../entities/push-subscription.entity.js';

export interface RegisterSubscriptionInput extends PushSubscriptionInput {
  salesChannelId: string;
  customerAccountId?: string | null;
}

export interface RegisterSubscriptionResult {
  id: string;
  status: 'active';
  created: boolean;
}

/**
 * The owner identity a `push_subscriptions` row can be written from — feature
 * 087 Group B, D-187.
 *
 * The customer arm carries the organisation because
 * `push_subscriptions_organization_attribution_chk` requires it, and it is a
 * type of its own rather than a second optional field on
 * {@link RegisterSubscriptionInput} because the caller's identity genuinely does
 * not include it: the storefront route reads the account off the session, and
 * the organisation is a fact about that account which this service resolves
 * through `customer_accounts`' read port.
 *
 * Keeping the two apart is what makes "an owned subscription with no
 * organisation" an unrepresentable argument to {@link ownerColumns} rather than
 * a line somebody has to remember — and, on this table, it is also what closes
 * the shape the `CHECK` deliberately does not: an **ownerless** row still
 * carrying an organisation. There is no arm here in which one column moves and
 * the other stays.
 */
type ResolvedSubscriptionOwner =
  | { kind: 'customer'; customerAccountId: string; organizationId: string }
  | { kind: 'anonymous' };

/**
 * The two attribution columns, written together from one resolved owner.
 *
 * Both directions of the upsert go through this function, which is the whole
 * point: signing in on a subscribed device stamps the account and the
 * organisation, and re-subscribing that same device anonymously clears both.
 */
function ownerColumns(owner: ResolvedSubscriptionOwner): {
  customerAccountId: string | null;
  organizationId: string | null;
} {
  return owner.kind === 'customer'
    ? { customerAccountId: owner.customerAccountId, organizationId: owner.organizationId }
    : {
        customerAccountId: null,
        // FR-011 / FR-023 — an anonymous device belongs to no organisation, and
        // the constraint says nothing about it. Who it *should* belong to is
        // R-6's open question and is not answered here. What matters is that
        // the organisation is cleared rather than left behind: a row with no
        // account and a stale organisation is disclosed to a representative of
        // an organisation that no longer owns the device.
        organizationId: null,
      };
}

/**
 * Push subscription registry (US4). Upsert on `endpoint` (idempotent re-subscribe,
 * FR-017, multi-device edge case), revoke (FR-018), and prune dead endpoints
 * reported by the provider (FR-022).
 */
export class PushSubscriptionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * `customer_accounts`' read model, for the one field the owner stamp needs:
     * the organisation the owning account belongs to (feature 087, D-187).
     *
     * Required rather than optional, because this module has exactly one
     * construction site (`plugin.ts`) and it holds the gated port already. A
     * composition that cannot answer "which organisation owns this account"
     * cannot write this table at all, and saying so in the constructor is
     * cheaper than a runtime refusal at the write.
     *
     * Resolved through `lazyPort`, so a switched-off `customer_accounts`
     * refuses at the call with the 503 `MODULE_DISABLED` envelope rather than
     * at composition time.
     */
    private readonly customerAccounts: CustomerAccountReadPort,
  ) {}

  /**
   * The organisation that owns a subscription belonging to this account —
   * feature 087 Group B, D-187.
   *
   * Total, and refuses rather than returning `null`:
   * `customer_accounts.organization_id` is `NOT NULL` (D-178), so an account
   * that resolves always has one, and an account that does not resolve is a
   * caller naming a row that is not there. Either way there is no organisation
   * to stamp, and a subscription written without one is a device hidden from
   * the representative who serves its buyer — which is the whole defect this
   * column exists to close. So the write stops here, where the message can name
   * the account, instead of at the constraint.
   */
  async #organizationOf(customerAccountId: string): Promise<string> {
    const account = await this.customerAccounts.findById(customerAccountId);
    if (!account) {
      throw new Error(
        `PushSubscriptionService: customer account ${customerAccountId} does not resolve, so the push subscription it would own has no organisation to carry.`,
      );
    }
    return account.organizationId;
  }

  /** The caller's owner input, with the organisation a customer owner implies. */
  async #resolveOwner(customerAccountId: string | null | undefined): Promise<ResolvedSubscriptionOwner> {
    if (customerAccountId === null || customerAccountId === undefined) return { kind: 'anonymous' };
    return {
      kind: 'customer',
      customerAccountId,
      organizationId: await this.#organizationOf(customerAccountId),
    };
  }

  async register(input: RegisterSubscriptionInput): Promise<RegisterSubscriptionResult> {
    // command-coverage-ignore: push-notification infrastructure — device
    // subscription / message delivery / icon asset, not audited domain state.
    const em = this.emFactory();
    const existing = await em.findOne(PushSubscription, { endpoint: input.endpoint });

    // D-187 — resolved **before** the managed entity is touched, not between
    // the account assignment and the flush. `existing` is managed, so a throw
    // after the assignment would leave an owned, unattributed subscription in
    // the unit of work for whatever flushes this request next.
    const owner = await this.#resolveOwner(input.customerAccountId);

    if (existing) {
      existing.p256dh = input.keys.p256dh;
      existing.auth = input.keys.auth;
      existing.salesChannelId = input.salesChannelId;
      // D-187 — the account and the organisation move together, in **both**
      // directions. Signing in on this device stamps both; re-subscribing it
      // anonymously clears both. The `CHECK` catches only the first of those,
      // by design (it is an implication, so R-6 stays open); the second is
      // held here, by there being no arm of `ownerColumns` that writes one
      // without the other. `em.assign` rather than two statements, for the same
      // reason `ownerColumns` returns both columns as one value: two statements
      // are two things to remember, and the second one is the one that was
      // never written.
      em.assign(existing, ownerColumns(owner));
      existing.status = 'active';
      existing.lastSeenAt = new Date();
      if (input.userAgent !== undefined) existing.userAgent = input.userAgent;
      await em.flush();
      return { id: existing.id, status: 'active', created: false };
    }

    const sub = em.create(PushSubscription, {
      salesChannelId: input.salesChannelId,
      // D-187 — the only place a subscription is inserted, and the organisation
      // goes in with the account. `ownerColumns` takes a *resolved* owner, so
      // the customer branch has no shape in which the organisation could be
      // omitted; the anonymous branch has none to carry (FR-011/FR-023).
      ...ownerColumns(owner),
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      provider: 'web_push',
      status: 'active',
      userAgent: input.userAgent ?? null,
      lastSeenAt: new Date(),
    });
    await em.persistAndFlush(sub);
    return { id: sub.id, status: 'active', created: true };
  }

  /** Revoke by endpoint. Idempotent — returns false if nothing was deleted. */
  async revoke(endpoint: string): Promise<boolean> {
    // command-coverage-ignore: push-notification infrastructure — device
    // subscription / message delivery / icon asset, not audited domain state.
    const em = this.emFactory();
    const existing = await em.findOne(PushSubscription, { endpoint });
    if (!existing) return false;
    await em.removeAndFlush(existing);
    return true;
  }

  /** Mark a subscription invalid and delete it (provider reported the endpoint gone). */
  async prune(subscriptionId: string): Promise<void> {
    // command-coverage-ignore: push-notification infrastructure — device
    // subscription / message delivery / icon asset, not audited domain state.
    const em = this.emFactory();
    const existing = await em.findOne(PushSubscription, { id: subscriptionId });
    if (!existing) return;
    await em.removeAndFlush(existing);
  }

  /**
   * `null` = the admin asked for a scope this deployment has no channel for, so
   * there is nothing subscribed to count. The column is `NOT NULL`, so the
   * query matches no row and the honest answer is zero — where the `'default'`
   * sentinel used to make PostgreSQL reject the comparison outright.
   */
  async statsForChannel(
    salesChannelId: string | null,
  ): Promise<{ active: number; invalid: number }> {
    const em = this.emFactory();
    const [active, invalid] = await Promise.all([
      em.count(PushSubscription, { salesChannelId, status: 'active' }),
      em.count(PushSubscription, { salesChannelId, status: 'invalid' }),
    ]);
    return { active, invalid };
  }
}
