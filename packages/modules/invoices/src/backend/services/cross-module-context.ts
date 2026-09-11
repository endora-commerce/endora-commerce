import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReadPort,
  CustomerAccountReadPort,
  OrderRecord,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { LoadAssetImage } from '../pdf-components/embed-logo-images.js';

/**
 * The three facts an invoice needs from outside this module
 * (`specs/110-instance-repository/` T118c).
 *
 * All three were `invoicesBridge` members — closures a composition root wrote,
 * once in `backend/src/composition.ts` and once in
 * `backend/test/helpers/test-server.ts`, with the same body in each. They are
 * functions of what they read rather than of a `ModuleContext`, so
 * `backend/index.ts` supplies the real inputs and this file is testable over a
 * stub with nothing composed.
 *
 * The other three members of that bridge needed no mapping at all and are not
 * here: the acting admin and the calling customer are the platform's own
 * `adminContextResolver` and `customerContextResolver`, read from the cradle,
 * and the transactional sender is `transactional_emails`' published
 * `transactionalEmailSenderAccessor`.
 */

/**
 * Where the invoice e-mail goes.
 *
 * `customer_accounts` publishes the record; this maps it to the one field the
 * dispatcher needs and answers `null` when no account resolves, which the
 * dispatcher reports as `no_recipient` rather than treating as sent.
 *
 * **No `catch`, deliberately.** `findById` on a `lazyPort` proxy throws
 * `ModuleDisabledError` when its owner is absent, and reading that as "this
 * buyer has no e-mail address" is the fail-open composition checklist item 7
 * refuses. `customer_accounts` declares `nonDeactivatable`, so it cannot happen
 * today; the absence of the `catch` is what keeps it fail-closed if that ever
 * changes.
 */
export function createRecipientEmailResolver(
  accounts: Pick<CustomerAccountReadPort, 'findById'>,
): (order: OrderRecord) => Promise<string | null> {
  return async (order) =>
    (await accounts.findById(order.placedByCustomerAccountId))?.email ?? null;
}

/**
 * The language the invoice e-mail is rendered in.
 *
 * A read of the platform's own `SalesChannel` entity through this module's
 * `EntityManager`, which is what both composition roots did and what `orders`
 * and `returns` do at the identical site — resolving the language for a
 * transactional e-mail.
 *
 * **Not `salesChannelResolutionPort`**, though the platform contributes it and
 * its `CachedChannel` carries `defaultLanguage`. That port is the *cache*, and
 * swapping a direct read for a cached one changes what this answers for a
 * channel written outside the invalidation path — a design decision about
 * channel reads rather than a drain's. Constitution XII is untouched either
 * way: this resolves no request channel, it reads one attribute of the channel
 * the invoice already names.
 *
 * `en-US` for an invoice with no channel, or a channel that is not there, is
 * the fallback both roots carried.
 */
export function createChannelLanguageResolver(
  emFactory: () => EntityManager,
): (salesChannelId: string | null) => Promise<string> {
  return async (salesChannelId) =>
    (salesChannelId
      ? (await emFactory().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage
      : null) ?? 'en-US';
}

/**
 * The operator's logo, as bytes pdfmake can inline.
 *
 * Two reads on one port, and the order is the point. `findById` is a metadata
 * question and cheap; `openAssetBytes` moves the object. Asking the cheap one
 * first is what keeps an asset that is not an image — a slot an operator can
 * point at anything — from being streamed into this process before it is
 * refused.
 *
 * **What is left here is this module's rule, and nothing about storage.** The
 * root closure it replaces dispatched on `storageBackend`, knew that `legacy`
 * has no `open`, knew that the locator falls back to `storageUrl`, and drained
 * the stream itself; all four are `assets_library`' now, behind
 * `openAssetBytes`. What cannot go there is which MIME types this consumer can
 * use: pdfmake embeds PNG and JPEG and nothing else, which is
 * `embed-logo-images.ts`' rule one layer down and is a fact about a PDF
 * renderer rather than about an asset library.
 *
 * **No `catch`, and that is a change from the closure.** The root wrapped the
 * storage half in one, because a backend that could not stream had to become an
 * invoice without a logo rather than an error. That degrade is in
 * `openAssetBytes`' return type now, where the owner can tell "this asset is
 * not there" from "the bucket did not answer" — so the only throw that could
 * still reach here is `ModuleDisabledError`, which must not be absorbed.
 */
export function createAssetImageLoader(
  assets: Pick<AssetReadPort, 'findById' | 'openAssetBytes'>,
): LoadAssetImage {
  return async (assetId) => {
    const record = await assets.findById(assetId, { liveOnly: true });
    if (!record || !record.mimeType.startsWith('image/')) return null;
    return assets.openAssetBytes(assetId);
  };
}
