import { entityNamed as classNamed } from '../../src/packages/package-entity-lookup.js';
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
import { entities as comparisonsEntities } from '@endora-commerce/mod-comparisons/backend';
import { entities as credentialsEntities } from '@endora-commerce/mod-credentials/backend';
import { entities as dictionariesEntities } from '@endora-commerce/mod-dictionaries/backend';
import { entities as ksefEntities } from '@endora-commerce/mod-ksef/backend';
import { entities as searchEntities } from '@endora-commerce/mod-search/backend';
import { entities as taxesEntities } from '@endora-commerce/mod-taxes/backend';
import { entities as assetsLibraryEntities } from '@endora-commerce/mod-assets-library/backend';
import { entities as cartsEntities } from '@endora-commerce/mod-carts/backend';
import { entities as customFieldsEntities } from '@endora-commerce/mod-custom-fields/backend';
import { entities as customersEntities } from '@endora-commerce/mod-customers/backend';
import { entities as emailEntities } from '@endora-commerce/mod-email/backend';
import { entities as invoicesEntities } from '@endora-commerce/mod-invoices/backend';
import { entities as pimErgonodeEntities } from '@endora-commerce/mod-pim-ergonode/backend';
import { entities as pimUnopimEntities } from '@endora-commerce/mod-pim-unopim/backend';
import { entities as productFeedsEntities } from '@endora-commerce/mod-product-feeds/backend';
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
import type { Comparison as ComparisonRow } from '../../../packages/modules/comparisons/src/backend/entities/comparison.entity.js';
import type { ComparisonProduct as ComparisonProductRow } from '../../../packages/modules/comparisons/src/backend/entities/comparison-product.entity.js';
import type { CredentialConfiguration as CredentialConfigurationRow } from '../../../packages/modules/credentials/src/backend/entities/credential-configuration.entity.js';
import type { Country as CountryRow } from '../../../packages/modules/dictionaries/src/backend/entities/country.entity.js';
import type { DictionaryTranslation as DictionaryTranslationRow } from '../../../packages/modules/dictionaries/src/backend/entities/dictionary-translation.entity.js';
import type { LanguageCountry as LanguageCountryRow } from '../../../packages/modules/dictionaries/src/backend/entities/language-country.entity.js';
import type { KsefCredential as KsefCredentialRow } from '../../../packages/modules/ksef/src/backend/entities/ksef-credential.entity.js';
import type { KsefSubmission as KsefSubmissionRow } from '../../../packages/modules/ksef/src/backend/entities/ksef-submission.entity.js';
import type { SearchPhraseRecord as SearchPhraseRecordRow } from '../../../packages/modules/search/src/backend/entities/search-phrase-record.entity.js';
import type { Tax as TaxRow } from '../../../packages/modules/taxes/src/backend/entities/tax.entity.js';
import type { Asset as AssetRow } from '../../../packages/modules/assets_library/src/backend/entities/asset.entity.js';
import type { AssetFolder as AssetFolderRow } from '../../../packages/modules/assets_library/src/backend/entities/asset-folder.entity.js';
import type { Cart as CartRow } from '../../../packages/modules/carts/src/backend/entities/cart.entity.js';
import type { CartItem as CartItemRow } from '../../../packages/modules/carts/src/backend/entities/cart-item.entity.js';
import type { CartAuditEntry as CartAuditEntryRow } from '../../../packages/modules/carts/src/backend/entities/cart-audit-entry.entity.js';
import type { CustomFieldDefinition as CustomFieldDefinitionRow } from '../../../packages/modules/custom_fields/src/backend/entities/custom-field-definition.entity.js';
import type { CustomFieldOption as CustomFieldOptionRow } from '../../../packages/modules/custom_fields/src/backend/entities/custom-field-option.entity.js';
import type { CustomerAddress as CustomerAddressRow } from '../../../packages/modules/customers/src/backend/entities/customer-address.entity.js';
import type { ErgonodeAttributeMapping as ErgonodeAttributeMappingRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-attribute-mapping.entity.js';
import type { ErgonodeCategoryMapping as ErgonodeCategoryMappingRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-category-mapping.entity.js';
import type { ErgonodeConnection as ErgonodeConnectionRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-connection.entity.js';
import type { ErgonodeFieldProtection as ErgonodeFieldProtectionRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-field-protection.entity.js';
import type { ErgonodeImportIssue as ErgonodeImportIssueRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-import-issue.entity.js';
import type { ErgonodeImportRun as ErgonodeImportRunRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-import-run.entity.js';
import type { ErgonodeMediaLink as ErgonodeMediaLinkRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-media-link.entity.js';
import type { ErgonodePriceBinding as ErgonodePriceBindingRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-price-binding.entity.js';
import type { ErgonodeProductLink as ErgonodeProductLinkRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-product-link.entity.js';
import type { ErgonodeStreamCursor as ErgonodeStreamCursorRow } from '../../../packages/modules/pim_ergonode/src/backend/entities/ergonode-stream-cursor.entity.js';
import type { UnopimConnection as UnopimConnectionRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-connection.entity.js';
import type { UnopimImportRun as UnopimImportRunRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-import-run.entity.js';
import type { UnopimProductLink as UnopimProductLinkRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-product-link.entity.js';
import type { UnopimSyncBookmark as UnopimSyncBookmarkRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-sync-bookmark.entity.js';
import type { UnopimCategoryMapping as UnopimCategoryMappingRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-category-mapping.entity.js';
import type { UnopimAttributeMapping as UnopimAttributeMappingRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-attribute-mapping.entity.js';
import type { UnopimAssociationTypeMapping as UnopimAssociationTypeMappingRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-association-type-mapping.entity.js';
import type { UnopimImportIssue as UnopimImportIssueRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-import-issue.entity.js';
import type { UnopimMediaLink as UnopimMediaLinkRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-media-link.entity.js';
import type { UnopimPriceBinding as UnopimPriceBindingRow } from '../../../packages/modules/pim_unopim/src/backend/entities/unopim-price-binding.entity.js';
import type { EmailDelivery as EmailDeliveryRow } from '../../../packages/modules/email/src/backend/entities/email-delivery.entity.js';
import type { Invoice as InvoiceRow } from '../../../packages/modules/invoices/src/backend/entities/invoice.entity.js';
import type { InvoiceLine as InvoiceLineRow } from '../../../packages/modules/invoices/src/backend/entities/invoice-line.entity.js';
import type { InvoiceNumberCounter as InvoiceNumberCounterRow } from '../../../packages/modules/invoices/src/backend/entities/invoice-number-counter.entity.js';
import type { InvoiceTemplate as InvoiceTemplateRow } from '../../../packages/modules/invoices/src/backend/entities/invoice-template.entity.js';
import type { FeedArtefact as FeedArtefactRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-artefact.entity.js';
import type { FeedDelivery as FeedDeliveryRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-delivery.entity.js';
import type { FeedDeliveryAttempt as FeedDeliveryAttemptRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-delivery-attempt.entity.js';
import type { FeedRun as FeedRunRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-run.entity.js';
import type { FeedRunIssue as FeedRunIssueRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-run-issue.entity.js';
import type { FeedTaxonomy as FeedTaxonomyRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-taxonomy.entity.js';
import type { FeedTaxonomyCheck as FeedTaxonomyCheckRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-taxonomy-check.entity.js';
import type { FeedTaxonomyMapping as FeedTaxonomyMappingRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-taxonomy-mapping.entity.js';
import type { FeedTaxonomyNode as FeedTaxonomyNodeRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-taxonomy-node.entity.js';
import type { FeedTemplate as FeedTemplateRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-template.entity.js';
import type { FeedTemplateField as FeedTemplateFieldRow } from '../../../packages/modules/product_feeds/src/backend/entities/feed-template-field.entity.js';
import type { ProductFeed as ProductFeedRow } from '../../../packages/modules/product_feeds/src/backend/entities/product-feed.entity.js';

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
/**
 * The lookup itself is the **host's**, not this file's (T040b, criterion 7).
 *
 * `src/packages/package-entity-lookup.ts` exists because a host program in the
 * compiled build needs exactly this, and two implementations of one lookup are
 * two answers waiting to disagree about what a missing name does. Only the
 * *type* half differs by tree, and deliberately: this one names the package's
 * **source**, which is legal here because the test program has no `rootDir`; the
 * host build sets one, so its call sites name the emitted declaration instead.
 */

export const QuoteRequest = classNamed<QuoteRequestRow>(quoteRequestsEntities, 'QuoteRequest');
export const QuoteRequestItem = classNamed<QuoteRequestItemRow>(
  quoteRequestsEntities,
  'QuoteRequestItem',
);
export const QuoteRequestRevision = classNamed<QuoteRequestRevisionRow>(
  quoteRequestsEntities,
  'QuoteRequestRevision',
);
export const GaCustomEvent = classNamed<GaCustomEventRow>(googleAnalyticsEntities, 'GaCustomEvent');

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
export const AdminNotification = classNamed<AdminNotificationRow>(
  adminNotificationsEntities,
  'AdminNotification',
);
export const ApiKey = classNamed<ApiKeyRow>(apiKeysEntities, 'ApiKey');
export const CmsPage = classNamed<CmsPageRow>(cmsEntities, 'CmsPage');
export const DeliveryMethod = classNamed<DeliveryMethodRow>(
  deliveryMethodsEntities,
  'DeliveryMethod',
);
export const MfaEnrolment = classNamed<MfaEnrolmentRow>(mfaEntities, 'MfaEnrolment');
export const MfaSocialIdentity = classNamed<MfaSocialIdentityRow>(mfaEntities, 'MfaSocialIdentity');
export const NewsletterAutomationRun = classNamed<NewsletterAutomationRunRow>(
  newsletterEntities,
  'NewsletterAutomationRun',
);
export const NewsletterCampaign = classNamed<NewsletterCampaignRow>(
  newsletterEntities,
  'NewsletterCampaign',
);
export const NewsletterCustomField = classNamed<NewsletterCustomFieldRow>(
  newsletterEntities,
  'NewsletterCustomField',
);
export const NewsletterEmailBlock = classNamed<NewsletterEmailBlockRow>(
  newsletterEntities,
  'NewsletterEmailBlock',
);
export const NewsletterSendRecord = classNamed<NewsletterSendRecordRow>(
  newsletterEntities,
  'NewsletterSendRecord',
);
export const NewsletterSubscriber = classNamed<NewsletterSubscriberRow>(
  newsletterEntities,
  'NewsletterSubscriber',
);
export const NewsletterSubscriberTag = classNamed<NewsletterSubscriberTagRow>(
  newsletterEntities,
  'NewsletterSubscriberTag',
);
export const NewsletterSuppression = classNamed<NewsletterSuppressionRow>(
  newsletterEntities,
  'NewsletterSuppression',
);
export const NewsletterTag = classNamed<NewsletterTagRow>(newsletterEntities, 'NewsletterTag');
export const PromptActionRequest = classNamed<PromptActionRequestRow>(
  promptActionsEntities,
  'PromptActionRequest',
);
export const Refund = classNamed<RefundRow>(returnsEntities, 'Refund');
export const ReturnCase = classNamed<ReturnCaseRow>(returnsEntities, 'ReturnCase');
export const ReturnCaseComment = classNamed<ReturnCaseCommentRow>(
  returnsEntities,
  'ReturnCaseComment',
);
export const ReturnCaseItem = classNamed<ReturnCaseItemRow>(returnsEntities, 'ReturnCaseItem');
export const ReturnReason = classNamed<ReturnReasonRow>(returnsEntities, 'ReturnReason');
export const ReturnShipment = classNamed<ReturnShipmentRow>(returnsEntities, 'ReturnShipment');
export const ReturnStatus = classNamed<ReturnStatusRow>(returnsEntities, 'ReturnStatus');
export const ReturnStatusTransition = classNamed<ReturnStatusTransitionRow>(
  returnsEntities,
  'ReturnStatusTransition',
);
export const ShoppingList = classNamed<ShoppingListRow>(shoppingListsEntities, 'ShoppingList');
export const TransactionalEmail = classNamed<TransactionalEmailRow>(
  transactionalEmailsEntities,
  'TransactionalEmail',
);
export const TransactionalEmailContent = classNamed<TransactionalEmailContentRow>(
  transactionalEmailsEntities,
  'TransactionalEmailContent',
);
export const Webhook = classNamed<WebhookRow>(webhooksEntities, 'Webhook');
export const WebhookDelivery = classNamed<WebhookDeliveryRow>(webhooksEntities, 'WebhookDelivery');

/**
 * Batch three (feature 080, T040b). Ten classes across six packages, each one a
 * class an integration or contract test hands to a live `EntityManager`.
 *
 * Same rule as batch two, and it excluded exactly one site: `KsefCredential` is
 * here because `integration/ksef/helpers.ts` persists one, while
 * `unit/ksef/ksef-auth.test.ts` calls `new KsefCredential()` against a stubbed
 * `EntityManager` and keeps its relative import into the package source — a
 * different object on purpose, and one no ORM ever sees.
 */
export const Comparison = classNamed<ComparisonRow>(comparisonsEntities, 'Comparison');
export const ComparisonProduct = classNamed<ComparisonProductRow>(
  comparisonsEntities,
  'ComparisonProduct',
);
export const CredentialConfiguration = classNamed<CredentialConfigurationRow>(
  credentialsEntities,
  'CredentialConfiguration',
);
export const Country = classNamed<CountryRow>(dictionariesEntities, 'Country');
export const DictionaryTranslation = classNamed<DictionaryTranslationRow>(
  dictionariesEntities,
  'DictionaryTranslation',
);
export const LanguageCountry = classNamed<LanguageCountryRow>(
  dictionariesEntities,
  'LanguageCountry',
);
export const KsefCredential = classNamed<KsefCredentialRow>(ksefEntities, 'KsefCredential');
export const KsefSubmission = classNamed<KsefSubmissionRow>(ksefEntities, 'KsefSubmission');
export const SearchPhraseRecord = classNamed<SearchPhraseRecordRow>(
  searchEntities,
  'SearchPhraseRecord',
);
export const Tax = classNamed<TaxRow>(taxesEntities, 'Tax');

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
  ComparisonRow,
  ComparisonProductRow,
  CredentialConfigurationRow,
  CountryRow,
  DictionaryTranslationRow,
  LanguageCountryRow,
  KsefCredentialRow,
  KsefSubmissionRow,
  SearchPhraseRecordRow,
  TaxRow,
};

/**
 * Batch four (feature 080, T040b). Thirteen classes across six packages, each one a
 * class an integration or contract test hands to a live `EntityManager`.
 *
 * Same rule as batches two and three — the *file* decides, not the class — and this
 * batch is the one where the rule bit hardest: `Cart` and `CartItem` are reached from
 * 48 sites between them, because a cart is what almost every checkout, pricing and
 * promotion test builds its fixture out of. Every one of those hands the class to the
 * harness's own `EntityManager`, so every one needed the composed copy; the unit tests
 * that construct a `Cart` against a stub keep their relative import into the package
 * source, which is a different object on purpose.
 *
 * `InvoiceTemplate` is here with no reaching test today. It is the fourth class of a
 * four-class package, and leaving it out would make this block a record of which tests
 * happen to exist rather than of what the package publishes — the next test to persist
 * one would otherwise reach for the source copy and find nothing telling it not to.
 */
export const Asset = classNamed<AssetRow>(assetsLibraryEntities, 'Asset');
export const AssetFolder = classNamed<AssetFolderRow>(assetsLibraryEntities, 'AssetFolder');
export const Cart = classNamed<CartRow>(cartsEntities, 'Cart');
export const CartItem = classNamed<CartItemRow>(cartsEntities, 'CartItem');
export const CartAuditEntry = classNamed<CartAuditEntryRow>(cartsEntities, 'CartAuditEntry');
export const CustomFieldDefinition = classNamed<CustomFieldDefinitionRow>(
  customFieldsEntities,
  'CustomFieldDefinition',
);
export const CustomFieldOption = classNamed<CustomFieldOptionRow>(
  customFieldsEntities,
  'CustomFieldOption',
);
export const CustomerAddress = classNamed<CustomerAddressRow>(customersEntities, 'CustomerAddress');
export const EmailDelivery = classNamed<EmailDeliveryRow>(emailEntities, 'EmailDelivery');
export const Invoice = classNamed<InvoiceRow>(invoicesEntities, 'Invoice');
export const InvoiceLine = classNamed<InvoiceLineRow>(invoicesEntities, 'InvoiceLine');
export const InvoiceNumberCounter = classNamed<InvoiceNumberCounterRow>(
  invoicesEntities,
  'InvoiceNumberCounter',
);
export const InvoiceTemplate = classNamed<InvoiceTemplateRow>(invoicesEntities, 'InvoiceTemplate');

/**
 * `pim_ergonode`'s ten entity classes — the largest block in this file, and the
 * one worth reading if you are wiring a second PIM integration.
 *
 * Every one of them is `@GlobalEntity()`: a connector's identity map, its run
 * history and its field protections describe the *catalogue*, which is
 * platform-global, so there is no organization dimension to scope by. An import
 * runs on a schedule with no request and therefore no tenant, so a tenant-scoped
 * connection row would be a row the importer could not read.
 */
export const ErgonodeAttributeMapping = classNamed<ErgonodeAttributeMappingRow>(
  pimErgonodeEntities,
  'ErgonodeAttributeMapping',
);
export const ErgonodeCategoryMapping = classNamed<ErgonodeCategoryMappingRow>(
  pimErgonodeEntities,
  'ErgonodeCategoryMapping',
);
export const ErgonodeConnection = classNamed<ErgonodeConnectionRow>(
  pimErgonodeEntities,
  'ErgonodeConnection',
);
export const ErgonodeFieldProtection = classNamed<ErgonodeFieldProtectionRow>(
  pimErgonodeEntities,
  'ErgonodeFieldProtection',
);
export const ErgonodeImportIssue = classNamed<ErgonodeImportIssueRow>(
  pimErgonodeEntities,
  'ErgonodeImportIssue',
);
export const ErgonodeImportRun = classNamed<ErgonodeImportRunRow>(
  pimErgonodeEntities,
  'ErgonodeImportRun',
);
export const ErgonodeMediaLink = classNamed<ErgonodeMediaLinkRow>(
  pimErgonodeEntities,
  'ErgonodeMediaLink',
);
export const ErgonodePriceBinding = classNamed<ErgonodePriceBindingRow>(
  pimErgonodeEntities,
  'ErgonodePriceBinding',
);
export const ErgonodeProductLink = classNamed<ErgonodeProductLinkRow>(
  pimErgonodeEntities,
  'ErgonodeProductLink',
);
export const ErgonodeStreamCursor = classNamed<ErgonodeStreamCursorRow>(
  pimErgonodeEntities,
  'ErgonodeStreamCursor',
);
export const UnopimConnection = classNamed<UnopimConnectionRow>(
  pimUnopimEntities,
  'UnopimConnection',
);
export const UnopimImportRun = classNamed<UnopimImportRunRow>(pimUnopimEntities, 'UnopimImportRun');
export const UnopimProductLink = classNamed<UnopimProductLinkRow>(
  pimUnopimEntities,
  'UnopimProductLink',
);
export const UnopimSyncBookmark = classNamed<UnopimSyncBookmarkRow>(
  pimUnopimEntities,
  'UnopimSyncBookmark',
);
export const UnopimCategoryMapping = classNamed<UnopimCategoryMappingRow>(
  pimUnopimEntities,
  'UnopimCategoryMapping',
);
export const UnopimAttributeMapping = classNamed<UnopimAttributeMappingRow>(
  pimUnopimEntities,
  'UnopimAttributeMapping',
);
export const UnopimAssociationTypeMapping = classNamed<UnopimAssociationTypeMappingRow>(
  pimUnopimEntities,
  'UnopimAssociationTypeMapping',
);
export const UnopimImportIssue = classNamed<UnopimImportIssueRow>(
  pimUnopimEntities,
  'UnopimImportIssue',
);
export const UnopimMediaLink = classNamed<UnopimMediaLinkRow>(
  pimUnopimEntities,
  'UnopimMediaLink',
);
export const UnopimPriceBinding = classNamed<UnopimPriceBindingRow>(
  pimUnopimEntities,
  'UnopimPriceBinding',
);

/**
 * The **row shapes** batch four's tests annotate with, on the same terms as
 * `PaymentMethodRow` above: `classNamed` returns a value, so a test that writes
 * `Promise<Cart>` needs the type under its own name. Four sites do —
 * `carts/cart-abandonment-sweep-cli`, `carts/cart-completed-order-fk`,
 * `perf/carts/abandonment-sweep` and `organizations/moderation-notification-scope`.
 * `export type` erases, so nothing is constructed and no second copy exists.
 */
export type { CartRow, CartItemRow, InvoiceRow, EmailDeliveryRow, AssetRow };

/**
 * `pim_ergonode`'s row shapes, on the same terms — five of its tests annotate a
 * helper's return type (`Promise<ErgonodeImportRun>`), and `classNamed` returns
 * a value, so the *type* has to arrive under its own name. `export type`
 * erases, so nothing is constructed and no second class object exists.
 */
export type {
  ErgonodeAttributeMappingRow,
  ErgonodeConnectionRow,
  ErgonodeImportIssueRow,
  ErgonodeImportRunRow,
  ErgonodeProductLinkRow,
  UnopimConnectionRow,
  UnopimImportRunRow,
  UnopimProductLinkRow,
  UnopimSyncBookmarkRow,
  UnopimCategoryMappingRow,
  UnopimAttributeMappingRow,
  UnopimImportIssueRow,
};

/**
 * Criterion 8 (feature 080, T040b). Twelve classes from one package, and the
 * reason every one of them is here rather than imported from the source is the
 * same reason the module needed a mechanism at all: this module's tests are
 * overwhelmingly integration and contract tests, which hand these classes to a
 * live `EntityManager`. The ORM registered them off the array below, so a
 * relative import into the package's source is a second class of the same name
 * — and for a `@TransitivelyScoped` tree that is not a quiet lookup miss but
 * `UnresolvableTenantParentError` at ORM init, taking down every file in the
 * fork (batch four's finding).
 *
 * The unit tests keep their relative import into the package source, and that
 * is legal and deliberate: each constructs its own object over a stubbed
 * `EntityManager` and registers nothing, so there is no second copy to
 * disagree with (D-168).
 */
export const FeedArtefact = classNamed<FeedArtefactRow>(productFeedsEntities, 'FeedArtefact');
export const FeedDelivery = classNamed<FeedDeliveryRow>(productFeedsEntities, 'FeedDelivery');
export const FeedDeliveryAttempt = classNamed<FeedDeliveryAttemptRow>(productFeedsEntities, 'FeedDeliveryAttempt');
export const FeedRun = classNamed<FeedRunRow>(productFeedsEntities, 'FeedRun');
export const FeedRunIssue = classNamed<FeedRunIssueRow>(productFeedsEntities, 'FeedRunIssue');
export const FeedTaxonomy = classNamed<FeedTaxonomyRow>(productFeedsEntities, 'FeedTaxonomy');
export const FeedTaxonomyCheck = classNamed<FeedTaxonomyCheckRow>(productFeedsEntities, 'FeedTaxonomyCheck');
export const FeedTaxonomyMapping = classNamed<FeedTaxonomyMappingRow>(productFeedsEntities, 'FeedTaxonomyMapping');
export const FeedTaxonomyNode = classNamed<FeedTaxonomyNodeRow>(productFeedsEntities, 'FeedTaxonomyNode');
export const FeedTemplate = classNamed<FeedTemplateRow>(productFeedsEntities, 'FeedTemplate');
export const FeedTemplateField = classNamed<FeedTemplateFieldRow>(productFeedsEntities, 'FeedTemplateField');
export const ProductFeed = classNamed<ProductFeedRow>(productFeedsEntities, 'ProductFeed');

/**
 * The **row shapes** this module's tests annotate with, on the same terms as
 * `PaymentMethodRow` above: `classNamed` returns a value, so a test that writes
 * `Promise<FeedRun>` needs the type under its own name. `export type` erases,
 * so nothing is constructed and no second copy exists.
 */
export type {
  FeedRunRow,
  ProductFeedRow,
  FeedTaxonomyRow,
  FeedTemplateRow,
  FeedArtefactRow,
  FeedDeliveryAttemptRow,
};
