import { entityNamedIn as classNamed } from '@endora-commerce/test-kit/support';

import { installedModuleEntities } from '../entities.generated.js';
import type { Session as SessionRow } from '../../../packages/modules/auth/src/backend/entities/session.entity.js';
import type { AttributeSet as AttributeSetRow } from '../../../packages/modules/catalog/src/backend/entities/attribute-set.entity.js';
import type { AttributeSetAttribute as AttributeSetAttributeRow } from '../../../packages/modules/catalog/src/backend/entities/attribute-set-attribute.entity.js';
import type { BulkOperation as BulkOperationRow } from '../../../packages/modules/catalog/src/backend/entities/bulk-operation.entity.js';
import type { BundleSlot as BundleSlotRow } from '../../../packages/modules/catalog/src/backend/entities/bundle-slot.entity.js';
import type { Category as CategoryRow } from '../../../packages/modules/catalog/src/backend/entities/category.entity.js';
import type { GalleryItem as GalleryItemRow } from '../../../packages/modules/catalog/src/backend/entities/gallery-item.entity.js';
import type { GalleryItemLabel as GalleryItemLabelRow } from '../../../packages/modules/catalog/src/backend/entities/gallery-item-label.entity.js';
import type { GroupedItem as GroupedItemRow } from '../../../packages/modules/catalog/src/backend/entities/grouped-item.entity.js';
import type { Product as ProductRow } from '../../../packages/modules/catalog/src/backend/entities/product.entity.js';
import type { ProductAttachment as ProductAttachmentRow } from '../../../packages/modules/catalog/src/backend/entities/product-attachment.entity.js';
import type { ProductAttribute as ProductAttributeRow } from '../../../packages/modules/catalog/src/backend/entities/product-attribute.entity.js';
import type { ProductLink as ProductLinkRow } from '../../../packages/modules/catalog/src/backend/entities/product-link.entity.js';
import type { ProductPackagingUnit as ProductPackagingUnitRow } from '../../../packages/modules/catalog/src/backend/entities/product-packaging-unit.entity.js';
import type { ProductValueOverride as ProductValueOverrideRow } from '../../../packages/modules/catalog/src/backend/entities/product-value-override.entity.js';
import type { ProductVariant as ProductVariantRow } from '../../../packages/modules/catalog/src/backend/entities/product-variant.entity.js';
import type { Address as AddressRow } from '../../../packages/modules/addresses/src/backend/entities/address.entity.js';
import type { AnalyticsEvent as AnalyticsEventRow } from '../../../packages/modules/analytics/src/backend/entities/analytics-event.entity.js';
import type { CreditLimit as CreditLimitRow } from '../../../packages/modules/credit_limits/src/backend/entities/credit-limit.entity.js';
import type { CreditLimitReservation as CreditLimitReservationRow } from '../../../packages/modules/credit_limits/src/backend/entities/credit-limit-reservation.entity.js';
import type { Currency as CurrencyRow } from '../../../packages/modules/currencies/src/backend/entities/currency.entity.js';
import type { GaCustomEvent as GaCustomEventRow } from '../../../packages/modules/google_analytics/src/backend/entities/ga-custom-event.entity.js';
import type { Language as LanguageRow } from '../../../packages/modules/languages/src/backend/entities/language.entity.js';
import type { TranslationBundle as TranslationBundleRow } from '../../../packages/modules/_i18n/src/backend/entities/translation-bundle.entity.js';
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
import type { MfaOrganizationPolicy as MfaOrganizationPolicyRow } from '../../../packages/modules/mfa/src/backend/entities/mfa-organization-policy.entity.js';
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
import type { PushSubscription as PushSubscriptionRow } from '../../../packages/modules/pwa/src/backend/entities/push-subscription.entity.js';
import type { ComparisonProduct as ComparisonProductRow } from '../../../packages/modules/comparisons/src/backend/entities/comparison-product.entity.js';
import type { CredentialConfiguration as CredentialConfigurationRow } from '../../../packages/modules/credentials/src/backend/entities/credential-configuration.entity.js';
import type { Country as CountryRow } from '../../../packages/modules/dictionaries/src/backend/entities/country.entity.js';
import type { DictionaryTranslation as DictionaryTranslationRow } from '../../../packages/modules/dictionaries/src/backend/entities/dictionary-translation.entity.js';
import type { LanguageCountry as LanguageCountryRow } from '../../../packages/modules/dictionaries/src/backend/entities/language-country.entity.js';
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
import type { CustomerAccount as CustomerAccountRow } from '../../../packages/modules/customer_accounts/src/backend/entities/customer-account.entity.js';
import type { CustomerGroup as CustomerGroupRow } from '../../../packages/modules/customer_accounts/src/backend/entities/customer-group.entity.js';
import type { PasswordResetToken as PasswordResetTokenRow } from '../../../packages/modules/customer_accounts/src/backend/entities/password-reset-token.entity.js';
import type { AvailabilityNotification as AvailabilityNotificationRow } from '../../../packages/modules/inventory/src/backend/entities/availability-notification.entity.js';
import type { InventoryThreshold as InventoryThresholdRow } from '../../../packages/modules/inventory/src/backend/entities/inventory-threshold.entity.js';
import type { ProductWarehouseLowStockThreshold as ProductWarehouseLowStockThresholdRow } from '../../../packages/modules/inventory/src/backend/entities/product-warehouse-low-stock-threshold.entity.js';
import type { StockAllocation as StockAllocationRow } from '../../../packages/modules/inventory/src/backend/entities/stock-allocation.entity.js';
import type { StockLevel as StockLevelRow } from '../../../packages/modules/inventory/src/backend/entities/stock-level.entity.js';
import type { WarehouseChannelAssignment as WarehouseChannelAssignmentRow } from '../../../packages/modules/inventory/src/backend/entities/warehouse-channel-assignment.entity.js';
import type { Warehouse as WarehouseRow } from '../../../packages/modules/inventory/src/backend/entities/warehouse.entity.js';
import type { EmailDelivery as EmailDeliveryRow } from '../../../packages/modules/email/src/backend/entities/email-delivery.entity.js';
import type { InvoiceLedgerClientMap as InvoiceLedgerClientMapRow } from '../../../packages/modules/invoice_ledger/src/backend/entities/invoice-ledger-client-map.entity.js';
import type { InvoiceLedgerDelivery as InvoiceLedgerDeliveryRow } from '../../../packages/modules/invoice_ledger/src/backend/entities/invoice-ledger-delivery.entity.js';
import type { InvoiceLedgerDocumentMap as InvoiceLedgerDocumentMapRow } from '../../../packages/modules/invoice_ledger/src/backend/entities/invoice-ledger-document-map.entity.js';
import type { InvoiceLedgerWebhookReceipt as InvoiceLedgerWebhookReceiptRow } from '../../../packages/modules/invoice_ledger/src/backend/entities/invoice-ledger-webhook-receipt.entity.js';
import type { InvoiceExternalAttachment as InvoiceExternalAttachmentRow } from '../../../packages/modules/invoices/src/backend/entities/invoice-external-attachment.entity.js';
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
import type { ModuleAction as ModuleActionRow } from '../../../packages/modules/admin_actions/src/backend/entities/module-action.entity.js';
import type { AdminRole as AdminRoleRow } from '../../../packages/modules/admin_roles/src/backend/entities/admin-role.entity.js';
import type { AdminUser as AdminUserRow } from '../../../packages/modules/admin_users/src/backend/entities/admin-user.entity.js';
import type { Megamenu as MegamenuRow } from '../../../packages/modules/megamenu/src/backend/entities/megamenu.entity.js';
import type { MegamenuItem as MegamenuItemRow } from '../../../packages/modules/megamenu/src/backend/entities/megamenu-item.entity.js';
import type { MegamenuBinding as MegamenuBindingRow } from '../../../packages/modules/megamenu/src/backend/entities/megamenu-binding.entity.js';
import type { Organization as OrganizationRow } from '../../../packages/modules/organizations/src/backend/entities/organization.entity.js';
import type { OrganizationSalesRepAssignment as OrganizationSalesRepAssignmentRow } from '../../../packages/modules/organizations/src/backend/entities/organization-sales-rep-assignment.entity.js';
import type { PriceList as PriceListRow } from '../../../packages/modules/price_lists/src/backend/entities/price-list.entity.js';
import type { PriceListProduct as PriceListProductRow } from '../../../packages/modules/price_lists/src/backend/entities/price-list-product.entity.js';
import type { PriceListPriceBracket as PriceListPriceBracketRow } from '../../../packages/modules/price_lists/src/backend/entities/price-list-price-bracket.entity.js';
import type { PriceDisplayModeOverride as PriceDisplayModeOverrideRow } from '../../../packages/modules/price_lists/src/backend/entities/price-display-mode-override.entity.js';
import type { Order as OrderRow } from '../../../packages/modules/orders/src/backend/entities/order.entity.js';
import type { OrderItem as OrderItemRow } from '../../../packages/modules/orders/src/backend/entities/order-item.entity.js';
import type { OrderComment as OrderCommentRow } from '../../../packages/modules/orders/src/backend/entities/order-comment.entity.js';
import type { OrderAppliedPromotion as OrderAppliedPromotionRow } from '../../../packages/modules/orders/src/backend/entities/order-applied-promotion.entity.js';
import type { OrderPlacementIntent as OrderPlacementIntentRow } from '../../../packages/modules/orders/src/backend/entities/order-placement-intent.entity.js';
import type { Payment as PaymentRow } from '../../../packages/modules/payments/src/backend/entities/payment.entity.js';

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
 * **Neither half of that split is this file's own any more** (T065).
 *
 * The **arrays** come off `../entities.generated.ts`, which
 * `composer:generate` renders from the module packages this tree holds; the
 * **lookup** is `@endora-commerce/test-kit/support`'s `entityNamedIn`, which
 * delegates to the platform's own `entityNamed` and adds the module dimension.
 * What is left here is the 169 named constants and their row types — which is
 * the part that is genuinely this repository's judgement about which entities its
 * own tests construct.
 *
 * ## Why this file stays, at this path
 *
 * `module-package-layout.md` R10's closing paragraph: it may not move into a
 * module package and may not be published by the kit either, because it *is* an
 * index of the modules one deployment installed and that is the one fact a
 * package naming no module is forbidden to know. Its import count is a reason to
 * keep its **path** stable and never a reason to publish it — so the 607 files
 * that name this path go on naming it, and what changed underneath them is where
 * the two halves come from.
 *
 * ## What the change buys, beyond removing 55 hand-written imports
 *
 * Three things, and the third is the one that matters outside this tree:
 *
 *  * the module set is no longer stated twice. A module added to this workspace
 *    used to need a line here; now `composer:generate` writes it, and
 *    `composer:check` reds a merge request whose index is stale.
 *  * a module that leaves the composition is a named refusal —
 *    `ModuleNotInstalledError`, naming the ids that are installed — rather than
 *    a `TypeError` on `undefined`.
 *  * **the kit's lookup is exercised here.** T016's landing measured the
 *    opposite: `composeTestServer` registered none of the four sales-channel
 *    kernel names, and an out-of-tree host found them one failed boot at a time,
 *    because the reference harness had registered them itself. A seam this
 *    repository does not use is a seam whose defects only a stranger sees.
 */

export const QuoteRequest = classNamed<QuoteRequestRow>(
  installedModuleEntities,
  'quote_requests',
  'QuoteRequest',
);
export const QuoteRequestItem = classNamed<QuoteRequestItemRow>(
  installedModuleEntities,
  'quote_requests',
  'QuoteRequestItem',
);
export const QuoteRequestRevision = classNamed<QuoteRequestRevisionRow>(
  installedModuleEntities,
  'quote_requests',
  'QuoteRequestRevision',
);
export const GaCustomEvent = classNamed<GaCustomEventRow>(
  installedModuleEntities,
  'google_analytics',
  'GaCustomEvent',
);

export const CreditLimit = classNamed<CreditLimitRow>(
  installedModuleEntities,
  'credit_limits',
  'CreditLimit',
);
export const CreditLimitReservation = classNamed<CreditLimitReservationRow>(
  installedModuleEntities,
  'credit_limits',
  'CreditLimitReservation',
);

export const Promotion = classNamed<PromotionRow>(
  installedModuleEntities,
  'promotions',
  'Promotion',
);

export const Address = classNamed<AddressRow>(installedModuleEntities, 'addresses', 'Address');

/**
 * `orders`' entity classes, taken off the package's own `entities` array.
 *
 * **`Order` is the one entity in this file where a second copy is not the
 * silent-empty failure D-160.6.1 describes.** It is a `@TransitivelyScoped`
 * chain parent — `invoices`' `Invoice` names it **by class name** — so two
 * `Order` classes in one process raise `UnresolvableTenantParentError` at ORM
 * init, inside `setupBackendServer`, which fails every file in the fork and
 * attributes the failure to whichever file happened to boot first. That is why
 * the fifty-two tests that used to name `order.entity.ts` by path come through
 * here instead.
 */
export const Order = classNamed<OrderRow>(installedModuleEntities, 'orders', 'Order');

export const Payment = classNamed<PaymentRow>(installedModuleEntities, 'payments', 'Payment');

export const OrderItem = classNamed<OrderItemRow>(installedModuleEntities, 'orders', 'OrderItem');

export const OrderComment = classNamed<OrderCommentRow>(
  installedModuleEntities,
  'orders',
  'OrderComment',
);

export const OrderAppliedPromotion = classNamed<OrderAppliedPromotionRow>(
  installedModuleEntities,
  'orders',
  'OrderAppliedPromotion',
);

export const OrderPlacementIntent = classNamed<OrderPlacementIntentRow>(
  installedModuleEntities,
  'orders',
  'OrderPlacementIntent',
);

export const Currency = classNamed<CurrencyRow>(installedModuleEntities, 'currencies', 'Currency');

export const Language = classNamed<LanguageRow>(installedModuleEntities, 'languages', 'Language');

/**
 * `_i18n`'s one entity — the table every module's translation bundles land in.
 *
 * Six live-ORM files persist or query a row of it while asserting on a
 * translated sentence, and each of them reached the entity relatively before
 * the module became a package. `check:singleton-identity` is what refuses that
 * spelling now, and D-160.6.1 is why: the ORM registered whichever class the
 * package's `entities` array carries, so a second copy read out of `src` is a
 * class it never discovered.
 */
export const TranslationBundle = classNamed<TranslationBundleRow>(
  installedModuleEntities,
  '_i18n',
  'TranslationBundle',
);

export const AnalyticsEvent = classNamed<AnalyticsEventRow>(
  installedModuleEntities,
  'analytics',
  'AnalyticsEvent',
);

export const Shipment = classNamed<ShipmentRow>(installedModuleEntities, 'shipments', 'Shipment');

export const PaymentMethod = classNamed<PaymentMethodRow>(
  installedModuleEntities,
  'payment_methods',
  'PaymentMethod',
);

export const Session = classNamed<SessionRow>(installedModuleEntities, 'auth', 'Session');

/**
 * `catalog` — twelve of the module's eighteen entity classes, the ones this
 * repository's tests construct or query. `Product` alone is named by 99 test
 * imports and `Category` by 35, which is what makes the single-copy property
 * above load-bearing here rather than theoretical: a relative reach into the
 * package's source would hand `em.find` a class the ORM never registered.
 */
export const AttributeSet = classNamed<AttributeSetRow>(
  installedModuleEntities,
  'catalog',
  'AttributeSet',
);
export const AttributeSetAttribute = classNamed<AttributeSetAttributeRow>(
  installedModuleEntities,
  'catalog',
  'AttributeSetAttribute',
);
export const BulkOperation = classNamed<BulkOperationRow>(
  installedModuleEntities,
  'catalog',
  'BulkOperation',
);
export const BundleSlot = classNamed<BundleSlotRow>(
  installedModuleEntities,
  'catalog',
  'BundleSlot',
);
export const Category = classNamed<CategoryRow>(installedModuleEntities, 'catalog', 'Category');
export const GalleryItem = classNamed<GalleryItemRow>(
  installedModuleEntities,
  'catalog',
  'GalleryItem',
);
export const GalleryItemLabel = classNamed<GalleryItemLabelRow>(
  installedModuleEntities,
  'catalog',
  'GalleryItemLabel',
);
export const GroupedItem = classNamed<GroupedItemRow>(
  installedModuleEntities,
  'catalog',
  'GroupedItem',
);
export const Product = classNamed<ProductRow>(installedModuleEntities, 'catalog', 'Product');
export const ProductAttachment = classNamed<ProductAttachmentRow>(
  installedModuleEntities,
  'catalog',
  'ProductAttachment',
);
export const ProductAttribute = classNamed<ProductAttributeRow>(
  installedModuleEntities,
  'catalog',
  'ProductAttribute',
);
export const ProductLink = classNamed<ProductLinkRow>(
  installedModuleEntities,
  'catalog',
  'ProductLink',
);
export const ProductPackagingUnit = classNamed<ProductPackagingUnitRow>(
  installedModuleEntities,
  'catalog',
  'ProductPackagingUnit',
);
export const ProductValueOverride = classNamed<ProductValueOverrideRow>(
  installedModuleEntities,
  'catalog',
  'ProductValueOverride',
);
export const ProductVariant = classNamed<ProductVariantRow>(
  installedModuleEntities,
  'catalog',
  'ProductVariant',
);

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
 * `catalog`'s row shapes, for the same reason and on the same terms.
 *
 * Twenty-eight test files annotate a variable, a parameter or a helper's return
 * with one of these while also handing the class to a live `EntityManager`, so
 * both halves are needed and the type half arrives under its own name. `export
 * type` erases; nothing here is a second copy of anything.
 */
export type {
  AttributeSetRow,
  BulkOperationRow,
  CategoryRow,
  ProductRow,
  ProductAttributeRow,
  ProductVariantRow,
};

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
  installedModuleEntities,
  'admin_notifications',
  'AdminNotification',
);
export const ApiKey = classNamed<ApiKeyRow>(installedModuleEntities, 'api_keys', 'ApiKey');
export const CmsPage = classNamed<CmsPageRow>(installedModuleEntities, 'cms', 'CmsPage');
export const DeliveryMethod = classNamed<DeliveryMethodRow>(
  installedModuleEntities,
  'delivery_methods',
  'DeliveryMethod',
);
export const MfaEnrolment = classNamed<MfaEnrolmentRow>(
  installedModuleEntities,
  'mfa',
  'MfaEnrolment',
);
export const MfaOrganizationPolicy = classNamed<MfaOrganizationPolicyRow>(
  installedModuleEntities,
  'mfa',
  'MfaOrganizationPolicy',
);
export const MfaSocialIdentity = classNamed<MfaSocialIdentityRow>(
  installedModuleEntities,
  'mfa',
  'MfaSocialIdentity',
);
export const NewsletterAutomationRun = classNamed<NewsletterAutomationRunRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterAutomationRun',
);
export const NewsletterCampaign = classNamed<NewsletterCampaignRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterCampaign',
);
export const NewsletterCustomField = classNamed<NewsletterCustomFieldRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterCustomField',
);
export const NewsletterEmailBlock = classNamed<NewsletterEmailBlockRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterEmailBlock',
);
export const NewsletterSendRecord = classNamed<NewsletterSendRecordRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterSendRecord',
);
export const NewsletterSubscriber = classNamed<NewsletterSubscriberRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterSubscriber',
);
export const NewsletterSubscriberTag = classNamed<NewsletterSubscriberTagRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterSubscriberTag',
);
export const NewsletterSuppression = classNamed<NewsletterSuppressionRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterSuppression',
);
export const NewsletterTag = classNamed<NewsletterTagRow>(
  installedModuleEntities,
  'newsletter',
  'NewsletterTag',
);
export const PromptActionRequest = classNamed<PromptActionRequestRow>(
  installedModuleEntities,
  'prompt_actions',
  'PromptActionRequest',
);
export const Refund = classNamed<RefundRow>(installedModuleEntities, 'returns', 'Refund');
export const ReturnCase = classNamed<ReturnCaseRow>(
  installedModuleEntities,
  'returns',
  'ReturnCase',
);
export const ReturnCaseComment = classNamed<ReturnCaseCommentRow>(
  installedModuleEntities,
  'returns',
  'ReturnCaseComment',
);
export const ReturnCaseItem = classNamed<ReturnCaseItemRow>(
  installedModuleEntities,
  'returns',
  'ReturnCaseItem',
);
export const ReturnReason = classNamed<ReturnReasonRow>(
  installedModuleEntities,
  'returns',
  'ReturnReason',
);
export const ReturnShipment = classNamed<ReturnShipmentRow>(
  installedModuleEntities,
  'returns',
  'ReturnShipment',
);
export const ReturnStatus = classNamed<ReturnStatusRow>(
  installedModuleEntities,
  'returns',
  'ReturnStatus',
);
export const ReturnStatusTransition = classNamed<ReturnStatusTransitionRow>(
  installedModuleEntities,
  'returns',
  'ReturnStatusTransition',
);
export const ShoppingList = classNamed<ShoppingListRow>(
  installedModuleEntities,
  'shopping_lists',
  'ShoppingList',
);
export const TransactionalEmail = classNamed<TransactionalEmailRow>(
  installedModuleEntities,
  'transactional_emails',
  'TransactionalEmail',
);
export const TransactionalEmailContent = classNamed<TransactionalEmailContentRow>(
  installedModuleEntities,
  'transactional_emails',
  'TransactionalEmailContent',
);
export const Webhook = classNamed<WebhookRow>(installedModuleEntities, 'webhooks', 'Webhook');
export const WebhookDelivery = classNamed<WebhookDeliveryRow>(
  installedModuleEntities,
  'webhooks',
  'WebhookDelivery',
);

/**
 * Batch three (feature 080, T040b). Ten classes across six packages, each one a
 * class an integration or contract test hands to a live `EntityManager`.
 *
 * `KsefCredential` and `KsefSubmission` were two of the ten; they left with
 * `ksef` (feature 134, T069), whose host tests were their only readers here.
 */
export const Comparison = classNamed<ComparisonRow>(
  installedModuleEntities,
  'comparisons',
  'Comparison',
);
export const PushSubscription = classNamed<PushSubscriptionRow>(
  installedModuleEntities,
  'pwa',
  'PushSubscription',
);
export const ComparisonProduct = classNamed<ComparisonProductRow>(
  installedModuleEntities,
  'comparisons',
  'ComparisonProduct',
);
export const CredentialConfiguration = classNamed<CredentialConfigurationRow>(
  installedModuleEntities,
  'credentials',
  'CredentialConfiguration',
);
export const Country = classNamed<CountryRow>(installedModuleEntities, 'dictionaries', 'Country');
export const DictionaryTranslation = classNamed<DictionaryTranslationRow>(
  installedModuleEntities,
  'dictionaries',
  'DictionaryTranslation',
);
export const LanguageCountry = classNamed<LanguageCountryRow>(
  installedModuleEntities,
  'dictionaries',
  'LanguageCountry',
);
export const SearchPhraseRecord = classNamed<SearchPhraseRecordRow>(
  installedModuleEntities,
  'search',
  'SearchPhraseRecord',
);
export const Tax = classNamed<TaxRow>(installedModuleEntities, 'taxes', 'Tax');

export type {
  AdminNotificationRow,
  ApiKeyRow,
  CmsPageRow,
  DeliveryMethodRow,
  MfaEnrolmentRow,
  MfaOrganizationPolicyRow,
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
export const Asset = classNamed<AssetRow>(installedModuleEntities, 'assets_library', 'Asset');
export const AssetFolder = classNamed<AssetFolderRow>(
  installedModuleEntities,
  'assets_library',
  'AssetFolder',
);
export const Cart = classNamed<CartRow>(installedModuleEntities, 'carts', 'Cart');
export const CartItem = classNamed<CartItemRow>(installedModuleEntities, 'carts', 'CartItem');
export const CartAuditEntry = classNamed<CartAuditEntryRow>(
  installedModuleEntities,
  'carts',
  'CartAuditEntry',
);
export const CustomFieldDefinition = classNamed<CustomFieldDefinitionRow>(
  installedModuleEntities,
  'custom_fields',
  'CustomFieldDefinition',
);
export const CustomFieldOption = classNamed<CustomFieldOptionRow>(
  installedModuleEntities,
  'custom_fields',
  'CustomFieldOption',
);
export const CustomerAddress = classNamed<CustomerAddressRow>(
  installedModuleEntities,
  'customers',
  'CustomerAddress',
);
export const CustomerAccount = classNamed<CustomerAccountRow>(
  installedModuleEntities,
  'customer_accounts',
  'CustomerAccount',
);
export const CustomerGroup = classNamed<CustomerGroupRow>(
  installedModuleEntities,
  'customer_accounts',
  'CustomerGroup',
);
export const PasswordResetToken = classNamed<PasswordResetTokenRow>(
  installedModuleEntities,
  'customer_accounts',
  'PasswordResetToken',
);
export const AvailabilityNotification = classNamed<AvailabilityNotificationRow>(
  installedModuleEntities,
  'inventory',
  'AvailabilityNotification',
);
export const InventoryThreshold = classNamed<InventoryThresholdRow>(
  installedModuleEntities,
  'inventory',
  'InventoryThreshold',
);
export const ProductWarehouseLowStockThreshold = classNamed<ProductWarehouseLowStockThresholdRow>(
  installedModuleEntities,
  'inventory',
  'ProductWarehouseLowStockThreshold',
);
export const StockAllocation = classNamed<StockAllocationRow>(
  installedModuleEntities,
  'inventory',
  'StockAllocation',
);
export const StockLevel = classNamed<StockLevelRow>(
  installedModuleEntities,
  'inventory',
  'StockLevel',
);
export const WarehouseChannelAssignment = classNamed<WarehouseChannelAssignmentRow>(
  installedModuleEntities,
  'inventory',
  'WarehouseChannelAssignment',
);
export const Warehouse = classNamed<WarehouseRow>(
  installedModuleEntities,
  'inventory',
  'Warehouse',
);
export const EmailDelivery = classNamed<EmailDeliveryRow>(
  installedModuleEntities,
  'email',
  'EmailDelivery',
);
export const InvoiceLedgerClientMap = classNamed<InvoiceLedgerClientMapRow>(
  installedModuleEntities,
  'invoice_ledger',
  'InvoiceLedgerClientMap',
);
export const InvoiceLedgerDelivery = classNamed<InvoiceLedgerDeliveryRow>(
  installedModuleEntities,
  'invoice_ledger',
  'InvoiceLedgerDelivery',
);
export const InvoiceLedgerDocumentMap = classNamed<InvoiceLedgerDocumentMapRow>(
  installedModuleEntities,
  'invoice_ledger',
  'InvoiceLedgerDocumentMap',
);
export const InvoiceLedgerWebhookReceipt = classNamed<InvoiceLedgerWebhookReceiptRow>(
  installedModuleEntities,
  'invoice_ledger',
  'InvoiceLedgerWebhookReceipt',
);
export const Invoice = classNamed<InvoiceRow>(installedModuleEntities, 'invoices', 'Invoice');
export const InvoiceExternalAttachment = classNamed<InvoiceExternalAttachmentRow>(
  installedModuleEntities,
  'invoices',
  'InvoiceExternalAttachment',
);
export const InvoiceLine = classNamed<InvoiceLineRow>(
  installedModuleEntities,
  'invoices',
  'InvoiceLine',
);
export const InvoiceNumberCounter = classNamed<InvoiceNumberCounterRow>(
  installedModuleEntities,
  'invoices',
  'InvoiceNumberCounter',
);
export const InvoiceTemplate = classNamed<InvoiceTemplateRow>(
  installedModuleEntities,
  'invoices',
  'InvoiceTemplate',
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
export const FeedArtefact = classNamed<FeedArtefactRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedArtefact',
);
export const FeedDelivery = classNamed<FeedDeliveryRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedDelivery',
);
export const FeedDeliveryAttempt = classNamed<FeedDeliveryAttemptRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedDeliveryAttempt',
);
export const FeedRun = classNamed<FeedRunRow>(installedModuleEntities, 'product_feeds', 'FeedRun');
export const FeedRunIssue = classNamed<FeedRunIssueRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedRunIssue',
);
export const FeedTaxonomy = classNamed<FeedTaxonomyRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedTaxonomy',
);
export const FeedTaxonomyCheck = classNamed<FeedTaxonomyCheckRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedTaxonomyCheck',
);
export const FeedTaxonomyMapping = classNamed<FeedTaxonomyMappingRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedTaxonomyMapping',
);
export const FeedTaxonomyNode = classNamed<FeedTaxonomyNodeRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedTaxonomyNode',
);
export const FeedTemplate = classNamed<FeedTemplateRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedTemplate',
);
export const FeedTemplateField = classNamed<FeedTemplateFieldRow>(
  installedModuleEntities,
  'product_feeds',
  'FeedTemplateField',
);
export const ProductFeed = classNamed<ProductFeedRow>(
  installedModuleEntities,
  'product_feeds',
  'ProductFeed',
);

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

/**
 * Batch five's six modules (feature 080, T040b).
 *
 * Same terms as every block above: the runtime class comes off the package's
 * published `entities` array **by name** — the one array the ORM registered, so
 * one copy (D-160.6.1) — and the row type from an `import type` of the package's
 * own source, which is free because it erases. This file's program has no
 * `rootDir`, which is why it may name package *source* where
 * `src/seeds/dev-catalog-seed.ts` may not.
 */
export const ModuleAction = classNamed<ModuleActionRow>(
  installedModuleEntities,
  'admin_actions',
  'ModuleAction',
);
export const AdminRole = classNamed<AdminRoleRow>(
  installedModuleEntities,
  'admin_roles',
  'AdminRole',
);
export const AdminUser = classNamed<AdminUserRow>(
  installedModuleEntities,
  'admin_users',
  'AdminUser',
);
export const Megamenu = classNamed<MegamenuRow>(installedModuleEntities, 'megamenu', 'Megamenu');
export const MegamenuItem = classNamed<MegamenuItemRow>(
  installedModuleEntities,
  'megamenu',
  'MegamenuItem',
);
export const MegamenuBinding = classNamed<MegamenuBindingRow>(
  installedModuleEntities,
  'megamenu',
  'MegamenuBinding',
);
export const Organization = classNamed<OrganizationRow>(
  installedModuleEntities,
  'organizations',
  'Organization',
);
export const OrganizationSalesRepAssignment = classNamed<OrganizationSalesRepAssignmentRow>(
  installedModuleEntities,
  'organizations',
  'OrganizationSalesRepAssignment',
);
export const PriceList = classNamed<PriceListRow>(
  installedModuleEntities,
  'price_lists',
  'PriceList',
);
export const PriceListProduct = classNamed<PriceListProductRow>(
  installedModuleEntities,
  'price_lists',
  'PriceListProduct',
);
export const PriceListPriceBracket = classNamed<PriceListPriceBracketRow>(
  installedModuleEntities,
  'price_lists',
  'PriceListPriceBracket',
);
export const PriceDisplayModeOverride = classNamed<PriceDisplayModeOverrideRow>(
  installedModuleEntities,
  'price_lists',
  'PriceDisplayModeOverride',
);

/**
 * The names the test tree also uses as a **type**, aliased.
 *
 * Not every name above needs one — a count would go stale on the next move
 * (D-100), so the list is exactly the names a `const x: Name` or
 * `Promise<Name>` in `backend/test/` names, and `tsc` is what keeps it honest.
 *
 * A real `class` declares a value and a type at once; `classNamed` returns only
 * the value, so the type has to be declared beside it or every
 * `const org: Organization` in the test tree becomes TS2749. `export type`
 * erases, so this constructs nothing and no second copy exists.
 */
export type ModuleAction = ModuleActionRow;
export type AdminRole = AdminRoleRow;
export type AdminUser = AdminUserRow;
export type Megamenu = MegamenuRow;
export type MegamenuItem = MegamenuItemRow;
export type MegamenuBinding = MegamenuBindingRow;
export type Organization = OrganizationRow;
export type OrganizationSalesRepAssignment = OrganizationSalesRepAssignmentRow;
export type PriceList = PriceListRow;
export type PriceListProduct = PriceListProductRow;
export type PriceListPriceBracket = PriceListPriceBracketRow;
export type PriceDisplayModeOverride = PriceDisplayModeOverrideRow;
export type CustomerAccount = CustomerAccountRow;
export type CustomerGroup = CustomerGroupRow;
export type PasswordResetToken = PasswordResetTokenRow;
export type AvailabilityNotification = AvailabilityNotificationRow;
export type InventoryThreshold = InventoryThresholdRow;
export type ProductWarehouseLowStockThreshold = ProductWarehouseLowStockThresholdRow;
export type StockAllocation = StockAllocationRow;
export type StockLevel = StockLevelRow;
export type WarehouseChannelAssignment = WarehouseChannelAssignmentRow;
export type Warehouse = WarehouseRow;
export type Order = OrderRow;
export type OrderItem = OrderItemRow;
export type OrderComment = OrderCommentRow;
export type OrderAppliedPromotion = OrderAppliedPromotionRow;
export type OrderPlacementIntent = OrderPlacementIntentRow;
export type Payment = PaymentRow;
export type Shipment = ShipmentRow;
export type NewsletterSubscriber = NewsletterSubscriberRow;

export type AdminNotification = AdminNotificationRow;

