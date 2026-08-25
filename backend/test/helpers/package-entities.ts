import type { EntityClass } from '@mikro-orm/core';
import { entities as adminNotificationsEntities } from '@endora-commerce/mod-admin-notifications/backend';
import { entities as apiKeysEntities } from '@endora-commerce/mod-api-keys/backend';
import { entities as cmsEntities } from '@endora-commerce/mod-cms/backend';
import { entities as deliveryMethodsEntities } from '@endora-commerce/mod-delivery-methods/backend';
import { entities as mfaEntities } from '@endora-commerce/mod-mfa/backend';
import { entities as newsletterEntities } from '@endora-commerce/mod-newsletter/backend';
import { entities as promptActionsEntities } from '@endora-commerce/mod-prompt-actions/backend';
import { entities as returnsEntities } from '@endora-commerce/mod-returns/backend';
import { entities as shoppingListsEntities } from '@endora-commerce/mod-shopping-lists/backend';
import { entities as transactionalEmailsEntities } from '@endora-commerce/mod-transactional-emails/backend';
import { entities as webhooksEntities } from '@endora-commerce/mod-webhooks/backend';
import { entities as addressesEntities } from '@endora-commerce/mod-addresses/backend';
import { entities as analyticsEntities } from '@endora-commerce/mod-analytics/backend';
import { entities as creditLimitsEntities } from '@endora-commerce/mod-credit-limits/backend';
import { entities as currenciesEntities } from '@endora-commerce/mod-currencies/backend';
import { entities as googleAnalyticsEntities } from '@endora-commerce/mod-google-analytics/backend';
import { entities as languagesEntities } from '@endora-commerce/mod-languages/backend';
import { entities as paymentMethodsEntities } from '@endora-commerce/mod-payment-methods/backend';
import { entities as promotionsEntities } from '@endora-commerce/mod-promotions/backend';
import { entities as quoteRequestsEntities } from '@endora-commerce/mod-quote-requests/backend';
import { entities as shipmentsEntities } from '@endora-commerce/mod-shipments/backend';
import type { Address as AddressRow } from '../../../packages/modules/addresses/src/backend/entities/address.entity.js';
import type { AnalyticsEvent as AnalyticsEventRow } from '../../../packages/modules/analytics/src/backend/entities/analytics-event.entity.js';
import type { CreditLimit as CreditLimitRow } from '../../../packages/modules/credit_limits/src/backend/entities/credit-limit.entity.js';
import type { CreditLimitReservation as CreditLimitReservationRow } from '../../../packages/modules/credit_limits/src/backend/entities/credit-limit-reservation.entity.js';
import type { Currency as CurrencyRow } from '../../../packages/modules/currencies/src/backend/entities/currency.entity.js';
import type { GaCustomEvent as GaCustomEventRow } from '../../../packages/modules/google_analytics/src/backend/entities/ga-custom-event.entity.js';
import type { Language as LanguageRow } from '../../../packages/modules/languages/src/backend/entities/language.entity.js';
import type { PaymentMethod as PaymentMethodRow } from '../../../packages/modules/payment_methods/src/backend/entities/payment-method.entity.js';
import type { Promotion as PromotionRow } from '../../../packages/modules/promotions/src/backend/entities/promotion.entity.js';
import type { QuoteRequest as QuoteRequestRow } from '../../../packages/modules/quote_requests/src/backend/entities/quote-request.entity.js';
import type { QuoteRequestItem as QuoteRequestItemRow } from '../../../packages/modules/quote_requests/src/backend/entities/quote-request-item.entity.js';
import type { QuoteRequestRevision as QuoteRequestRevisionRow } from '../../../packages/modules/quote_requests/src/backend/entities/quote-request-revision.entity.js';
import type { Shipment as ShipmentRow } from '../../../packages/modules/shipments/src/backend/entities/shipment.entity.js';
import type { AdminNotification as AdminNotificationRow } from '../../../packages/modules/admin_notifications/src/backend/entities/admin-notification.entity.js';
import type { ApiKey as ApiKeyRow } from '../../../packages/modules/api_keys/src/backend/entities/api-key.entity.js';
import type { CmsPage as CmsPageRow } from '../../../packages/modules/cms/src/backend/entities/cms-page.entity.js';
import type { DeliveryMethod as DeliveryMethodRow } from '../../../packages/modules/delivery_methods/src/backend/entities/delivery-method.entity.js';
import type { MfaEnrolment as MfaEnrolmentRow } from '../../../packages/modules/mfa/src/backend/entities/mfa-enrolment.entity.js';
import type { MfaSocialIdentity as MfaSocialIdentityRow } from '../../../packages/modules/mfa/src/backend/entities/mfa-social-identity.entity.js';
import type { NewsletterAutomationRun as NewsletterAutomationRunRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-automation-run.entity.js';
import type { NewsletterCampaign as NewsletterCampaignRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-campaign.entity.js';
import type { NewsletterCustomField as NewsletterCustomFieldRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-custom-field.entity.js';
import type { NewsletterEmailBlock as NewsletterEmailBlockRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-email-block.entity.js';
import type { NewsletterSendRecord as NewsletterSendRecordRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-send-record.entity.js';
import type { NewsletterSubscriber as NewsletterSubscriberRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-subscriber.entity.js';
import type { NewsletterSubscriberTag as NewsletterSubscriberTagRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-subscriber-tag.entity.js';
import type { NewsletterSuppression as NewsletterSuppressionRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-suppression.entity.js';
import type { NewsletterTag as NewsletterTagRow } from '../../../packages/modules/newsletter/src/backend/entities/newsletter-tag.entity.js';
import type { PromptActionRequest as PromptActionRequestRow } from '../../../packages/modules/prompt_actions/src/backend/entities/prompt-action-request.entity.js';
import type { Refund as RefundRow } from '../../../packages/modules/returns/src/backend/entities/refund.entity.js';
import type { ReturnCase as ReturnCaseRow } from '../../../packages/modules/returns/src/backend/entities/return-case.entity.js';
import type { ReturnCaseComment as ReturnCaseCommentRow } from '../../../packages/modules/returns/src/backend/entities/return-case-comment.entity.js';
import type { ReturnCaseItem as ReturnCaseItemRow } from '../../../packages/modules/returns/src/backend/entities/return-case-item.entity.js';
import type { ReturnReason as ReturnReasonRow } from '../../../packages/modules/returns/src/backend/entities/return-reason.entity.js';
import type { ReturnShipment as ReturnShipmentRow } from '../../../packages/modules/returns/src/backend/entities/return-shipment.entity.js';
import type { ReturnStatus as ReturnStatusRow } from '../../../packages/modules/returns/src/backend/entities/return-status.entity.js';
import type { ReturnStatusTransition as ReturnStatusTransitionRow } from '../../../packages/modules/returns/src/backend/entities/return-status-transition.entity.js';
import type { ShoppingList as ShoppingListRow } from '../../../packages/modules/shopping_lists/src/backend/entities/shopping-list.entity.js';
import type { TransactionalEmail as TransactionalEmailRow } from '../../../packages/modules/transactional_emails/src/backend/entities/transactional-email.entity.js';
import type { TransactionalEmailContent as TransactionalEmailContentRow } from '../../../packages/modules/transactional_emails/src/backend/entities/transactional-email-content.entity.js';
import type { Webhook as WebhookRow } from '../../../packages/modules/webhooks/src/backend/entities/webhook.entity.js';
import type { WebhookDelivery as WebhookDeliveryRow } from '../../../packages/modules/webhooks/src/backend/entities/webhook-delivery.entity.js';

/**
 * How a test names a **module package's** entity class (D-168).
 *
 * A module package publishes one `entities` array and no entity class by name,
 * which is what makes `import { QuoteRequest } from
 * '@endora-commerce/mod-quote-requests/backend'` a compile error in a stranger's
 * tree. It is the same compile error here, and this repository's own tests do
 * legitimately need the class — eight of them call `em.find(QuoteRequest, …)`.
 *
 * The obvious repair is the wrong one, and it is worth writing down because it
 * type-checks. Importing the entity **by relative path into the package's
 * source** — the door `blog`'s tests already use for its services — produces a
 * *second* class object: the ORM registered the one behind
 * `dist/backend/entities/…`, because that is what `entities-registry.generated.ts`
 * imports, and MikroORM keys its metadata on the class. Passing the source copy
 * to `em.find` asks the ORM about a class it never discovered. That is D-160.6's
 * measurement, and for a decorated file it is also D-164's: a `tsx` process
 * lowering an entity outside its own tsconfig kills it at load.
 *
 * So the split here is deliberate and is the whole content of this file:
 *
 *  * the **runtime class** comes from the package's published `entities` array —
 *    the one array the host's ORM registered, so there is exactly one of it;
 *  * the **shape** comes from a `import type` of the source file, which erases
 *    at compile time and therefore constructs nothing. A stranger cannot write
 *    that import: an installed package ships `dist` behind an `exports` map that
 *    refuses a deep path for types as well as for values, so D-168's property is
 *    untouched. We can, for the same reason `blog`'s tests can reach its service
 *    files — a workspace member's directory is right there on disk, and the
 *    `exports` map does not gate a filesystem path.
 *
 * Resolution is **by class name**, never by index. A tuple index would compile
 * for any ordering, so re-ordering the array in the package would silently
 * re-point every test in this repository at a different table.
 */
function classNamed<T>(list: readonly unknown[], name: string): EntityClass<T> {
  const found = list.find(
    (entry): entry is EntityClass<T> =>
      typeof entry === 'function' && (entry as { name?: string }).name === name,
  );
  if (found === undefined) {
    const present = list
      .map((entry) => (typeof entry === 'function' ? (entry as { name?: string }).name : '?'))
      .join(', ');
    throw new Error(
      `[package-entities] no entity class named '${name}' in the package's published ` +
        `'entities' array (it declares: ${present || '(empty)'}). Either the class was ` +
        `renamed, or it was left out of the array — which the host answers by mapping it to ` +
        `no table, silently. See D-168.`,
    );
  }
  return found;
}

export const QuoteRequest = classNamed<QuoteRequestRow>(quoteRequestsEntities, 'QuoteRequest');
export const QuoteRequestItem = classNamed<QuoteRequestItemRow>(
  quoteRequestsEntities,
  'QuoteRequestItem',
);
export const QuoteRequestRevision = classNamed<QuoteRequestRevisionRow>(
  quoteRequestsEntities,
  'QuoteRequestRevision',
);
export const GaCustomEvent = classNamed<GaCustomEventRow>(
  googleAnalyticsEntities,
  'GaCustomEvent',
);

export const CreditLimit = classNamed<CreditLimitRow>(creditLimitsEntities, 'CreditLimit');
export const CreditLimitReservation = classNamed<CreditLimitReservationRow>(
  creditLimitsEntities,
  'CreditLimitReservation',
);

export const Promotion = classNamed<PromotionRow>(promotionsEntities, 'Promotion');

export const Address = classNamed<AddressRow>(addressesEntities, 'Address');

export const Currency = classNamed<CurrencyRow>(currenciesEntities, 'Currency');

export const Language = classNamed<LanguageRow>(languagesEntities, 'Language');

export const AnalyticsEvent = classNamed<AnalyticsEventRow>(analyticsEntities, 'AnalyticsEvent');

export const Shipment = classNamed<ShipmentRow>(shipmentsEntities, 'Shipment');

export const PaymentMethod = classNamed<PaymentMethodRow>(paymentMethodsEntities, 'PaymentMethod');

/**
 * The **row shape**, for a test that annotates a variable with it.
 *
 * `classNamed` returns MikroORM's `EntityClass<T>`, which is
 * `Function & { prototype: T }` — a value, and deliberately not a type and not
 * constructable. Five integration tests write `em.create(PaymentMethod, …)`
 * *and* `async function place(method: PaymentMethod)`, so they need both halves,
 * and the type half has to arrive under its own name because the value half
 * already occupies the class's.
 *
 * It re-exports the same `import type` the constants above are built from, so
 * the shape a test annotates with and the shape `classNamed` was asked for are
 * one declaration. Nothing is constructed: `export type` erases.
 *
 * A test that only ever calls `new PaymentMethod()` — three unit tests over a
 * stubbed `EntityManager`, which hand the class to no ORM — wants neither half
 * and imports the class from the package's source directly. That is not a hole
 * in this door: D-160.6's second-class-object hazard is about the class the ORM
 * registered metadata for, and a test that registers nothing has no second copy
 * to disagree with.
 */
export type { PaymentMethodRow };

/**
 * Batch two (feature 080, T040b). Twenty-nine classes across thirteen packages, each
 * one a class an integration or contract test hands to a live `EntityManager`.
 *
 * The rule that decided which imports moved here and which did not is the file, not
 * the class: a test that touches a real `EntityManager` needs the class the ORM
 * registered, and a unit test that constructs its own object does not — five of those
 * keep their relative import into the package source, which is legal and is a
 * different object on purpose.
 */
export const AdminNotification = classNamed<AdminNotificationRow>(adminNotificationsEntities, 'AdminNotification');
export const ApiKey = classNamed<ApiKeyRow>(apiKeysEntities, 'ApiKey');
export const CmsPage = classNamed<CmsPageRow>(cmsEntities, 'CmsPage');
export const DeliveryMethod = classNamed<DeliveryMethodRow>(deliveryMethodsEntities, 'DeliveryMethod');
export const MfaEnrolment = classNamed<MfaEnrolmentRow>(mfaEntities, 'MfaEnrolment');
export const MfaSocialIdentity = classNamed<MfaSocialIdentityRow>(mfaEntities, 'MfaSocialIdentity');
export const NewsletterAutomationRun = classNamed<NewsletterAutomationRunRow>(newsletterEntities, 'NewsletterAutomationRun');
export const NewsletterCampaign = classNamed<NewsletterCampaignRow>(newsletterEntities, 'NewsletterCampaign');
export const NewsletterCustomField = classNamed<NewsletterCustomFieldRow>(newsletterEntities, 'NewsletterCustomField');
export const NewsletterEmailBlock = classNamed<NewsletterEmailBlockRow>(newsletterEntities, 'NewsletterEmailBlock');
export const NewsletterSendRecord = classNamed<NewsletterSendRecordRow>(newsletterEntities, 'NewsletterSendRecord');
export const NewsletterSubscriber = classNamed<NewsletterSubscriberRow>(newsletterEntities, 'NewsletterSubscriber');
export const NewsletterSubscriberTag = classNamed<NewsletterSubscriberTagRow>(newsletterEntities, 'NewsletterSubscriberTag');
export const NewsletterSuppression = classNamed<NewsletterSuppressionRow>(newsletterEntities, 'NewsletterSuppression');
export const NewsletterTag = classNamed<NewsletterTagRow>(newsletterEntities, 'NewsletterTag');
export const PromptActionRequest = classNamed<PromptActionRequestRow>(promptActionsEntities, 'PromptActionRequest');
export const Refund = classNamed<RefundRow>(returnsEntities, 'Refund');
export const ReturnCase = classNamed<ReturnCaseRow>(returnsEntities, 'ReturnCase');
export const ReturnCaseComment = classNamed<ReturnCaseCommentRow>(returnsEntities, 'ReturnCaseComment');
export const ReturnCaseItem = classNamed<ReturnCaseItemRow>(returnsEntities, 'ReturnCaseItem');
export const ReturnReason = classNamed<ReturnReasonRow>(returnsEntities, 'ReturnReason');
export const ReturnShipment = classNamed<ReturnShipmentRow>(returnsEntities, 'ReturnShipment');
export const ReturnStatus = classNamed<ReturnStatusRow>(returnsEntities, 'ReturnStatus');
export const ReturnStatusTransition = classNamed<ReturnStatusTransitionRow>(returnsEntities, 'ReturnStatusTransition');
export const ShoppingList = classNamed<ShoppingListRow>(shoppingListsEntities, 'ShoppingList');
export const TransactionalEmail = classNamed<TransactionalEmailRow>(transactionalEmailsEntities, 'TransactionalEmail');
export const TransactionalEmailContent = classNamed<TransactionalEmailContentRow>(transactionalEmailsEntities, 'TransactionalEmailContent');
export const Webhook = classNamed<WebhookRow>(webhooksEntities, 'Webhook');
export const WebhookDelivery = classNamed<WebhookDeliveryRow>(webhooksEntities, 'WebhookDelivery');

export type {
  AdminNotificationRow,
  ApiKeyRow,
  CmsPageRow,
  DeliveryMethodRow,
  MfaEnrolmentRow,
  MfaSocialIdentityRow,
  NewsletterAutomationRunRow,
  NewsletterCampaignRow,
  NewsletterCustomFieldRow,
  NewsletterEmailBlockRow,
  NewsletterSendRecordRow,
  NewsletterSubscriberRow,
  NewsletterSubscriberTagRow,
  NewsletterSuppressionRow,
  NewsletterTagRow,
  PromptActionRequestRow,
  RefundRow,
  ReturnCaseRow,
  ReturnCaseCommentRow,
  ReturnCaseItemRow,
  ReturnReasonRow,
  ReturnShipmentRow,
  ReturnStatusRow,
  ReturnStatusTransitionRow,
  ShoppingListRow,
  TransactionalEmailRow,
  TransactionalEmailContentRow,
  WebhookRow,
  WebhookDeliveryRow,
};
