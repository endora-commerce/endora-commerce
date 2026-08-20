import type { EntityManager } from '@mikro-orm/postgresql';
import type { Queue } from 'bullmq';
import type {
  CustomerAccountReadPort,
  OrganizationDetailsPort,
  PushAudience,
  PushTrigger,
} from '@b2b/contracts';
import { PushMessage } from '../entities/push-message.entity.js';
import { PushMessageDelivery } from '../entities/push-message-delivery.entity.js';
import { PushSubscription } from '../entities/push-subscription.entity.js';
import { evaluatePushAudienceRule } from './push-audience-evaluator.js';
import type { PushDeliveryJobData } from './push-delivery-queue.js';

/** Resolved customer context for a linked subscription, used by rule targeting. */
interface CustomerContext {
  organizationId: string | null;
  customerGroupId: string | null;
}

export interface CreateMessageInput {
  salesChannelId: string;
  title: string;
  body: string;
  url?: string | null;
  iconUrl?: string | null;
  audience: PushAudience;
  trigger: PushTrigger;
  sourceEventId?: string | null;
  createdByAdminUserId?: string | null;
}

export interface CreateMessageResult {
  messageId: string;
  queuedDeliveries: number;
}

/**
 * Push message lifecycle (US4). Creates a message, expands the audience into
 * delivery rows, and enqueues one BullMQ job per delivery (producer-only — it
 * never sends inline, Principle X). Event-triggered messages are idempotent on
 * `(trigger, source_event_id)` via the partial unique index.
 */
export class PushMessageService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly queue: Queue<PushDeliveryJobData>,
    /**
     * The two rows rule targeting needs, asked of the modules that own them
     * (feature 075, Phase C). Both are gated: with `customer_accounts` or
     * `organizations` switched off the send refuses rather than pushing to an
     * audience it could not resolve.
     */
    private readonly customerAccounts: CustomerAccountReadPort,
    private readonly organizations: OrganizationDetailsPort,
  ) {}

  async createAndEnqueue(input: CreateMessageInput): Promise<CreateMessageResult> {
    // command-coverage-ignore: push-notification infrastructure — device
    // subscription / message delivery / icon asset, not audited domain state.
    const em = this.emFactory();

    // Idempotency guard for event-triggered sends: a duplicate event is a no-op.
    if (input.sourceEventId) {
      const dup = await em.findOne(PushMessage, {
        trigger: input.trigger,
        sourceEventId: input.sourceEventId,
      });
      if (dup) return { messageId: dup.id, queuedDeliveries: 0 };
    }

    // Expanded **before** the message row is written. Rule targeting now asks
    // two other modules for the rows it resolves a subscriber's context from,
    // so it can refuse (503 `MODULE_DISABLED`); persisting first would leave a
    // `queued` message behind that nothing will ever deliver.
    const subscriptions = await this.resolveAudience(em, input.salesChannelId, input.audience);

    const message = em.create(PushMessage, {
      salesChannelId: input.salesChannelId,
      title: input.title,
      body: input.body,
      url: input.url ?? null,
      iconUrl: input.iconUrl ?? null,
      audience: input.audience,
      trigger: input.trigger,
      sourceEventId: input.sourceEventId ?? null,
      status: 'queued',
      sentCount: 0,
      failedCount: 0,
      createdByAdminUserId: input.createdByAdminUserId ?? null,
    });
    await em.persistAndFlush(message);

    const deliveries = subscriptions.map((sub) =>
      em.create(PushMessageDelivery, {
        messageId: message.id,
        subscriptionId: sub.id,
        status: 'pending',
        attempts: 0,
      }),
    );
    if (deliveries.length > 0) {
      await em.persistAndFlush(deliveries);
      await this.queue.addBulk(
        deliveries.map((d) => ({
          name: 'deliver',
          data: { deliveryId: d.id },
          opts: { jobId: d.id },
        })),
      );
    }

    return { messageId: message.id, queuedDeliveries: deliveries.length };
  }

  private async resolveAudience(
    em: EntityManager,
    salesChannelId: string,
    audience: PushAudience,
  ): Promise<PushSubscription[]> {
    if (audience.kind === 'all') {
      return em.find(PushSubscription, { salesChannelId, status: 'active' });
    }
    if (audience.kind === 'customers') {
      return em.find(PushSubscription, {
        salesChannelId,
        status: 'active',
        customerAccountId: { $in: audience.customerAccountIds },
      });
    }

    // kind === 'rule' — narrow active channel subscribers by their resolved
    // customer context. Anonymous subscribers only match salesChannel/all.
    const subscriptions = await em.find(PushSubscription, { salesChannelId, status: 'active' });
    const accountIds = [
      ...new Set(
        subscriptions
          .map((s) => s.customerAccountId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const contexts = await this.loadCustomerContexts(accountIds);
    return subscriptions.filter((sub) => {
      const ctx = sub.customerAccountId ? contexts.get(sub.customerAccountId) : undefined;
      return evaluatePushAudienceRule(audience.rule, {
        salesChannelId,
        customerAccountId: sub.customerAccountId ?? null,
        organizationId: ctx?.organizationId ?? null,
        customerGroupId: ctx?.customerGroupId ?? null,
      });
    });
  }

  /**
   * Batch-resolve `{ organizationId, effective customerGroupId }` for each
   * linked customer account. The effective group follows the same chain the
   * pricing engine uses: `account.customerGroupId ?? organization.customerGroupId`.
   *
   * Both rows arrive over their owners' published ports, so a switched-off
   * `customer_accounts` or `organizations` refuses here rather than reporting
   * an audience of nobody — which reads as a legitimate answer and is not one.
   */
  private async loadCustomerContexts(accountIds: string[]): Promise<Map<string, CustomerContext>> {
    const map = new Map<string, CustomerContext>();
    if (accountIds.length === 0) return map;

    const accounts = await this.customerAccounts.findByIds(accountIds);
    const orgIds = [
      ...new Set(
        accounts
          .map((a) => a.organizationId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const orgGroups = new Map<string, string | null>();
    if (orgIds.length > 0) {
      const orgs = await this.organizations.findByIds(orgIds);
      for (const org of orgs) orgGroups.set(org.id, org.customerGroupId ?? null);
    }

    for (const account of accounts) {
      const orgGroup = account.organizationId
        ? orgGroups.get(account.organizationId) ?? null
        : null;
      map.set(account.id, {
        organizationId: account.organizationId ?? null,
        customerGroupId: account.customerGroupId ?? orgGroup,
      });
    }
    return map;
  }
}
