import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { CustomerEmailResolver } from './return-email-notifier.js';

/**
 * The two facts a return notification needs from outside this module
 * (`specs/110-instance-repository/` T118c).
 *
 * Both were `returnsBridge` members — closures a composition root wrote, once in
 * `backend/src/composition.ts` and once in `backend/test/helpers/test-server.ts`,
 * with the same body in each. They are functions of what they read rather than of
 * a `ModuleContext`, so `backend/index.ts` supplies the real inputs and this file
 * is testable over a stub with nothing composed.
 */

/**
 * Where the authorize / reject e-mail goes.
 *
 * `customer_accounts` publishes the record; this maps it to the one field the
 * notifier needs and answers `null` when no account resolves, which the notifier
 * reports as `no_recipient` rather than treating as sent.
 *
 * **No `catch`, deliberately.** `findById` on a `lazyPort` proxy throws
 * `ModuleDisabledError` when its owner is absent, and reading that as "this buyer
 * has no e-mail address" is the fail-open composition checklist item 7 refuses.
 * `customer_accounts` declares `nonDeactivatable`, so it cannot happen today; the
 * absence of the `catch` is what keeps it fail-closed if that ever changes.
 */
export function createCustomerEmailResolver(
  accounts: Pick<CustomerAccountReadPort, 'findById'>,
): CustomerEmailResolver {
  return async (customerAccountId) => (await accounts.findById(customerAccountId))?.email ?? null;
}

/**
 * The language a channel's e-mail is rendered in.
 *
 * A read of the platform's own `SalesChannel` entity through this module's
 * `EntityManager`, which is what both composition roots did and what `orders`
 * does at the identical site — resolving the language for a transactional e-mail
 * (`order-service.ts`, `sendOrderConfirmation`).
 *
 * **Not `salesChannelResolutionPort`**, though the platform contributes it and it
 * carries `defaultLanguage` on its `CachedChannel`. That port is the *cache*, and
 * swapping a direct read for a cached one changes what this answers for a channel
 * written outside the invalidation path — a design decision about channel reads,
 * not a drain's, and T118c moves a value rather than redesigning it. Constitution
 * XII is untouched either way: this resolves no request channel, it reads one
 * attribute of a channel the return case already names.
 *
 * `en-US` for a channel that is not there is the fallback both roots carried.
 */
export function createChannelLanguageResolver(
  emFactory: () => EntityManager,
): (salesChannelId: string) => Promise<string> {
  return async (salesChannelId) =>
    (await emFactory().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US';
}
