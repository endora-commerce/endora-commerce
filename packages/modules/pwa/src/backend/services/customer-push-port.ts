import {
  PWA_SETTING_CODES,
  type CustomerAccountReadPort,
  type CustomerPushCategory,
  type CustomerPushPort,
  type PushPreferences,
} from '@endora-commerce/contracts';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import type { CreateMessageInput, CreateMessageResult } from './push-message-service.js';
import type { PushPreferenceReader } from './status-push-composer.js';

/**
 * `customerPushPort` — `specs/179-rfq-and-customer-notifications/` FR-060,
 * research R-12, `contracts/delivery-and-ports.md` §2.
 *
 * Another module pushes to one customer account through this port: it has
 * already decided who is told and rendered the sentence in the language it
 * chose, and this module decides whether a push may go out at all. The gates
 * are the status-push composer's (`specs/149-pwa-order-status-push/` research
 * R-11), cheapest first, plus one the composer leaves to the message service —
 * whether the account has a device to push to, which a caller keeping a record
 * of the outcome needs told apart from a push that went out:
 *
 *   1. the channel — the input's, or the system default for `null`;
 *   2. `pwa.push_enabled` **and** the category's switch on that channel;
 *   3. the account — missing, deleted, anonymised or not a member of the
 *      Organization the caller names (Principle XI) ⇒ `no_account`;
 *   4. the account's preference for the category;
 *   5. an active device subscription on that channel;
 *   6. write the push message and enqueue its deliveries.
 *
 * Producer only (Principle X): the delivery worker sends. The `sourceKey` is
 * the message's `source_event_id` under trigger `quote_request`, so a repeated
 * key writes nothing and still answers `enqueued` — the caller's retry after a
 * crash between this call and its own commit costs no second push.
 *
 * Registered with `ctx.di.providePort`, so a switched-off `pwa` refuses with
 * `ModuleDisabledError`; callers ask presence in front of it (D-60).
 */

export interface CustomerPushPortDeps {
  /** Only for `salesChannelId: null` — the system default channel. */
  channels: Pick<SalesChannelResolutionPort, 'getSystemDefault'>;
  /** A boolean `pwa.*` setting for a channel; a read that fails answers `false`. */
  isSettingOn: (code: string, salesChannelId: string) => Promise<boolean>;
  customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
  /** The customer preference read; absent row ⇒ every category on. */
  preferences: PushPreferenceReader;
  /** Whether the account has an active device subscription on the channel. */
  hasActiveSubscription: (customerAccountId: string, salesChannelId: string) => Promise<boolean>;
  messageService: {
    createAndEnqueue(input: CreateMessageInput): Promise<CreateMessageResult>;
  };
  /**
   * `enterSystemScope` in production: the reads are `@CustomerScoped` and
   * constrained by the account id explicitly, whatever context the caller had
   * — a worker's system scope, or none.
   */
  runInSystemScope: <T>(reason: string, run: () => Promise<T>) => Promise<T>;
}

const SCOPE_REASON = 'pwa: a customer push names one account and is constrained by it';

const CATEGORY_SETTING: Record<CustomerPushCategory, string> = {
  quote: PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED,
};

const CATEGORY_PREFERENCE: Record<CustomerPushCategory, (preference: PushPreferences) => boolean> = {
  quote: (preference) => preference.quoteStatus,
};

const CATEGORY_TRIGGER: Record<CustomerPushCategory, CreateMessageInput['trigger']> = {
  quote: 'quote_request',
};

export function createCustomerPushPort(deps: CustomerPushPortDeps): CustomerPushPort {
  return {
    push: (input) =>
      deps.runInSystemScope(SCOPE_REASON, async () => {
        // The caller's channel is taken as it is — even one the resolver no
        // longer knows is still the channel the devices subscribed on (the
        // composer's rule); the language was the caller's to choose.
        const channelId = input.salesChannelId ?? (await deps.channels.getSystemDefault()).id;

        const [pushOn, categoryOn] = await Promise.all([
          deps.isSettingOn(PWA_SETTING_CODES.PUSH_ENABLED, channelId),
          deps.isSettingOn(CATEGORY_SETTING[input.category], channelId),
        ]);
        if (!pushOn || !categoryOn) return 'skipped:switched_off';

        const account = await deps.customerAccounts.findById(input.customerAccountId);
        if (!account || account.deletedAt || account.anonymizedAt) return 'skipped:no_account';
        if (account.organizationId !== input.organizationId) return 'skipped:no_account';

        const preference = await deps.preferences.read(account.id);
        if (!CATEGORY_PREFERENCE[input.category](preference)) return 'skipped:customer_preference';

        if (!(await deps.hasActiveSubscription(account.id, channelId))) return 'skipped:no_subscription';

        await deps.messageService.createAndEnqueue({
          salesChannelId: channelId,
          title: input.title,
          body: input.body,
          url: input.url,
          audience: { kind: 'customers', customerAccountIds: [account.id] },
          trigger: CATEGORY_TRIGGER[input.category],
          sourceEventId: input.sourceKey,
        });
        return 'enqueued';
      }),
  };
}
