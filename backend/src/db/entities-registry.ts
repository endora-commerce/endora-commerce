import { Session } from '../modules/auth/entities/session.entity.js';
// Stripe payment gateway (feature 049)
import { StripeCustomer } from '../modules/stripe/entities/stripe-customer.entity.js';
import { StripeSavedCard } from '../modules/stripe/entities/stripe-saved-card.entity.js';
import { StripePaymentIntent } from '../modules/stripe/entities/stripe-payment-intent.entity.js';
import { StripeWebhookEvent } from '../modules/stripe/entities/stripe-webhook-event.entity.js';
import { StripePaymentMethodRule } from '../modules/stripe/entities/stripe-payment-method-rule.entity.js';
import { StripePaymentMethodOrgDisable } from '../modules/stripe/entities/stripe-payment-method-org-disable.entity.js';
// TPay payment gateway (feature 063)
import { TpayTransaction } from '../modules/tpay/entities/tpay-transaction.entity.js';
import { TpayNotificationEvent } from '../modules/tpay/entities/tpay-notification-event.entity.js';
import { TpaySavedCard } from '../modules/tpay/entities/tpay-saved-card.entity.js';
import { TpayBlikAlias } from '../modules/tpay/entities/tpay-blik-alias.entity.js';
import { TpayPaymentMethodRule } from '../modules/tpay/entities/tpay-payment-method-rule.entity.js';
import { TpayPaymentMethodOrgDisable } from '../modules/tpay/entities/tpay-payment-method-org-disable.entity.js';
import { PayuOrder } from '../modules/payu/entities/payu-order.entity.js';
import { PayuNotificationEvent } from '../modules/payu/entities/payu-notification-event.entity.js';
import { PayuSavedCard } from '../modules/payu/entities/payu-saved-card.entity.js';
import { PayuBlikAlias } from '../modules/payu/entities/payu-blik-alias.entity.js';
import { PayuPaymentMethodRule } from '../modules/payu/entities/payu-payment-method-rule.entity.js';
import { PayuPaymentMethodOrgDisable } from '../modules/payu/entities/payu-payment-method-org-disable.entity.js';
import { AutopayTransaction } from '../modules/autopay/entities/autopay-transaction.entity.js';
import { AutopayNotificationEvent } from '../modules/autopay/entities/autopay-notification-event.entity.js';
import { AutopaySavedCard } from '../modules/autopay/entities/autopay-saved-card.entity.js';
import { AutopayBlikAlias } from '../modules/autopay/entities/autopay-blik-alias.entity.js';
import { AutopayPaymentMethodRule } from '../modules/autopay/entities/autopay-payment-method-rule.entity.js';
import { AutopayPaymentMethodOrgDisable } from '../modules/autopay/entities/autopay-payment-method-org-disable.entity.js';
import { CustomFieldDefinition } from '../modules/custom_fields/entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../modules/custom_fields/entities/custom-field-option.entity.js';
import { AuditLogEntry } from '../kernel/audit/audit-log-entry.entity.js';
import { Asset } from '../modules/assets_library/entities/asset.entity.js';
import { AssetFolder } from '../modules/assets_library/entities/asset-folder.entity.js';
import { Product } from '../modules/catalog/entities/product.entity.js';
import { ProductVariant } from '../modules/catalog/entities/product-variant.entity.js';
import { Category } from '../modules/catalog/entities/category.entity.js';
import { ProductAttribute } from '../modules/catalog/entities/product-attribute.entity.js';
import { ProductValueOverride } from '../modules/catalog/entities/product-value-override.entity.js';
import { ProductEditorPreference } from '../modules/catalog/entities/product-editor-preference.entity.js';
import { BulkOperation } from '../modules/catalog/entities/bulk-operation.entity.js';
import { AttributeSet } from '../modules/catalog/entities/attribute-set.entity.js';
import { AttributeSetAttribute } from '../modules/catalog/entities/attribute-set-attribute.entity.js';
import { GalleryItem } from '../modules/catalog/entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../modules/catalog/entities/gallery-item-label.entity.js';
import { AttachmentType } from '../modules/catalog/entities/attachment-type.entity.js';
import { ProductAttachment } from '../modules/catalog/entities/product-attachment.entity.js';
import { ProductLink } from '../modules/catalog/entities/product-link.entity.js';
import { GroupedItem } from '../modules/catalog/entities/grouped-item.entity.js';
import { ProductPackagingUnit } from '../modules/catalog/entities/product-packaging-unit.entity.js';
import { BundleSlot } from '../modules/catalog/entities/bundle-slot.entity.js';
import { BundleSlotOption } from '../modules/catalog/entities/bundle-slot-option.entity.js';
import { SalesChannel } from '../kernel/sales-channels/sales-channel.entity.js';
import { AvailabilityNotification } from '../modules/inventory/entities/availability-notification.entity.js';
import { QuoteRequest } from '../modules/quote_requests/entities/quote-request.entity.js';
import { QuoteRequestItem } from '../modules/quote_requests/entities/quote-request-item.entity.js';
import { Organization } from '../modules/organizations/entities/organization.entity.js';
import { CustomerAccount } from '../modules/customer_accounts/entities/customer-account.entity.js';
import { Address } from '../modules/addresses/entities/address.entity.js';
import { CustomerAddress } from '../modules/customers/entities/customer-address.entity.js';
import { EmailVerificationToken } from '../modules/organizations/entities/email-verification-token.entity.js';
import { OrganizationTaxIdValidation } from '../modules/organizations/entities/organization-tax-id-validation.entity.js';
import { OrganizationPaymentMethodLink } from '../modules/organizations/entities/organization-payment-method-link.entity.js';
import { OrganizationDeliveryMethodLink } from '../modules/organizations/entities/organization-delivery-method-link.entity.js';
import { OrganizationWarehouseLink } from '../modules/organizations/entities/organization-warehouse-link.entity.js';
import { AdminNotification } from '../modules/admin_notifications/entities/admin-notification.entity.js';
import { AdminNotificationRead } from '../modules/admin_notifications/entities/admin-notification-read.entity.js';
import { QuickOrderDefaultPreference } from '../modules/quick_order/entities/quick-order-default-preference.entity.js';
import { MfaEnrolment } from '../modules/mfa/entities/mfa-enrolment.entity.js';
import { MfaRecoveryCode } from '../modules/mfa/entities/mfa-recovery-code.entity.js';
import { MfaSocialIdentity } from '../modules/mfa/entities/mfa-social-identity.entity.js';
import { MfaOrganizationPolicy } from '../modules/mfa/entities/mfa-organization-policy.entity.js';
import { PromptActionRequest } from '../modules/prompt_actions/entities/prompt-action-request.entity.js';
import { PushSubscription } from '../modules/pwa/entities/push-subscription.entity.js';
import { PushMessage } from '../modules/pwa/entities/push-message.entity.js';
import { PushMessageDelivery } from '../modules/pwa/entities/push-message-delivery.entity.js';
import { PwaIconRendition } from '../modules/pwa/entities/pwa-icon-rendition.entity.js';
import { TransactionalEmail } from '../modules/transactional_emails/entities/transactional-email.entity.js';
import { TransactionalEmailContent } from '../modules/transactional_emails/entities/transactional-email-content.entity.js';
import { EmailBlock } from '../modules/transactional_emails/entities/email-block.entity.js';
import { EmailBlockSalesChannel } from '../modules/transactional_emails/entities/email-block-sales-channel.entity.js';
import { EmailTemplate } from '../modules/transactional_emails/entities/email-template.entity.js';
import { EmailTemplateSalesChannel } from '../modules/transactional_emails/entities/email-template-sales-channel.entity.js';
import { NewsletterSubscriber } from '../modules/newsletter/entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../modules/newsletter/entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../modules/newsletter/entities/newsletter-subscriber-tag.entity.js';
import { NewsletterCustomField } from '../modules/newsletter/entities/newsletter-custom-field.entity.js';
import { NewsletterSuppression } from '../modules/newsletter/entities/newsletter-suppression.entity.js';
import { NewsletterEmailBlock } from '../modules/newsletter/entities/newsletter-email-block.entity.js';
import { NewsletterEmailBlockSalesChannel } from '../modules/newsletter/entities/newsletter-email-block-sales-channel.entity.js';
import { NewsletterCampaign } from '../modules/newsletter/entities/newsletter-campaign.entity.js';
import { NewsletterCampaignSubscriber } from '../modules/newsletter/entities/newsletter-campaign-subscriber.entity.js';
import { NewsletterSendRecord } from '../modules/newsletter/entities/newsletter-send-record.entity.js';
import { NewsletterEngagementEvent } from '../modules/newsletter/entities/newsletter-engagement-event.entity.js';
import { GaCustomEvent } from '../modules/google_analytics/entities/ga-custom-event.entity.js';
import { LinkedInConversionMapping } from '../modules/linkedin_ads/entities/linkedin-conversion-mapping.entity.js';
import { MetaCustomEventMapping } from '../modules/meta_ads/entities/meta-custom-event-mapping.entity.js';
import { NewsletterAutomation } from '../modules/newsletter/entities/newsletter-automation.entity.js';
import { NewsletterAutomationRun } from '../modules/newsletter/entities/newsletter-automation-run.entity.js';
import { Cart } from '../modules/carts/entities/cart.entity.js';
import { CartItem } from '../modules/carts/entities/cart-item.entity.js';
import { CartAuditEntry } from '../modules/carts/entities/cart-audit-entry.entity.js';
import { StockLevel } from '../modules/inventory/entities/stock-level.entity.js';
import { DeliveryMethod } from '../modules/delivery_methods/entities/delivery-method.entity.js';
import { PaymentMethod } from '../modules/payment_methods/entities/payment-method.entity.js';
import { Order } from '../modules/orders/entities/order.entity.js';
import { OrderItem } from '../modules/orders/entities/order-item.entity.js';
import { OrderAppliedPromotion } from '../modules/orders/entities/order-applied-promotion.entity.js';
import { OrderStatus } from '../modules/orders/entities/order-status.entity.js';
import { OrderStatusTransition } from '../modules/orders/entities/order-status-transition.entity.js';
import { OrderComment } from '../modules/orders/entities/order-comment.entity.js';
import { OrderListSavedView } from '../modules/orders/entities/order-list-saved-view.entity.js';
// Feature 062 — Distributor API: durable order-intake idempotency.
import { OrderPlacementIntent } from '../modules/orders/entities/order-placement-intent.entity.js';
// Feature 046 — Returns & Complaints (Refunds, RMA).
import { ReturnStatus } from '../modules/returns/entities/return-status.entity.js';
import { ReturnStatusTransition } from '../modules/returns/entities/return-status-transition.entity.js';
import { ReturnCase } from '../modules/returns/entities/return-case.entity.js';
import { ReturnCaseItem } from '../modules/returns/entities/return-case-item.entity.js';
import { ReturnCaseComment } from '../modules/returns/entities/return-case-comment.entity.js';
import { ReturnReason } from '../modules/returns/entities/return-reason.entity.js';
import { ReturnDeliveryMethod } from '../modules/returns/entities/return-delivery-method.entity.js';
import { Refund } from '../modules/returns/entities/refund.entity.js';
import { ReturnShipment } from '../modules/returns/entities/return-shipment.entity.js';
import { ReturnCaseAttachment } from '../modules/returns/entities/return-case-attachment.entity.js';
import { ReturnListSavedView } from '../modules/returns/entities/return-list-saved-view.entity.js';
import { Payment } from '../modules/payments/entities/payment.entity.js';
import { Shipment } from '../modules/shipments/entities/shipment.entity.js';
import { Invoice } from '../modules/invoices/entities/invoice.entity.js';
import { InvoiceLine } from '../modules/invoices/entities/invoice-line.entity.js';
import { InvoiceNumberCounter } from '../modules/invoices/entities/invoice-number-counter.entity.js';
import { InvoiceTemplate } from '../modules/invoices/entities/invoice-template.entity.js';
import { OrganizationInvitation } from '../modules/organizations/entities/organization-invitation.entity.js';
import { AdminUser } from '../modules/admin_users/entities/admin-user.entity.js';
import { AdminRole } from '../modules/admin_roles/entities/admin-role.entity.js';
import { PasswordResetToken } from '../modules/customer_accounts/entities/password-reset-token.entity.js';
import { CreditLimit } from '../modules/credit_limits/entities/credit-limit.entity.js';
import { CreditLimitReservation } from '../modules/credit_limits/entities/credit-limit-reservation.entity.js';
import { ApiKey } from '../modules/api_keys/entities/api-key.entity.js';
import { Webhook } from '../modules/webhooks/entities/webhook.entity.js';
import { WebhookDelivery } from '../modules/webhooks/entities/webhook-delivery.entity.js';
import { AnalyticsEvent } from '../modules/analytics/entities/analytics-event.entity.js';
import { SeoMetaOverride } from '../modules/seo/entities/seo-meta-override.entity.js';
import { SitemapCache } from '../modules/seo/entities/sitemap-cache.entity.js';
import { Language } from '../modules/languages/entities/language.entity.js';
import { Currency } from '../modules/currencies/entities/currency.entity.js';
import { CmsPage } from '../modules/cms/entities/cms-page.entity.js';
import { CmsBlock } from '../modules/cms/entities/cms-block.entity.js';
import { CmsTemplate } from '../modules/cms/entities/cms-template.entity.js';
import { CmsHook } from '../modules/cms/entities/cms-hook.entity.js';
import { CmsHookBlockAttachment } from '../modules/cms/entities/cms-hook-block-attachment.entity.js';
import { Megamenu } from '../modules/megamenu/entities/megamenu.entity.js';
import { MegamenuItem } from '../modules/megamenu/entities/megamenu-item.entity.js';
import { MegamenuBinding } from '../modules/megamenu/entities/megamenu-binding.entity.js';
import { BlogCategory } from '../modules/blog/entities/blog-category.entity.js';
import { BlogCategorySalesChannel } from '../modules/blog/entities/blog-category-sales-channel.entity.js';
import { BlogCategoryLanguage } from '../modules/blog/entities/blog-category-language.entity.js';
import { BlogPost } from '../modules/blog/entities/blog-post.entity.js';
import { BlogPostSalesChannel } from '../modules/blog/entities/blog-post-sales-channel.entity.js';
import { BlogPostLanguage } from '../modules/blog/entities/blog-post-language.entity.js';
import { BlogPostCategory } from '../modules/blog/entities/blog-post-category.entity.js';
import { BlogPostTag } from '../modules/blog/entities/blog-post-tag.entity.js';
import { BlogPostRelatedPost } from '../modules/blog/entities/blog-post-related-post.entity.js';
import { BlogPostRelatedProduct } from '../modules/blog/entities/blog-post-related-product.entity.js';
import { BlogTag } from '../modules/blog/entities/blog-tag.entity.js';
import { Country } from '../modules/dictionaries/entities/country.entity.js';
import { DictionaryTranslation } from '../modules/dictionaries/entities/dictionary-translation.entity.js';
import { LanguageCountry } from '../modules/dictionaries/entities/language-country.entity.js';
import { CustomerGroup } from '../modules/price_lists/entities/customer-group.entity.js';
import { PriceList } from '../modules/price_lists/entities/price-list.entity.js';
import { PriceListProduct } from '../modules/price_lists/entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../modules/price_lists/entities/price-list-price-bracket.entity.js';
import { PriceDisplayModeOverride } from '../modules/price_lists/entities/price-display-mode-override.entity.js';
import { Tax } from '../modules/taxes/entities/tax.entity.js';
import { Promotion } from '../modules/promotions/entities/promotion.entity.js';
import { PromotionRuleEntity } from '../modules/promotions/entities/promotion-rule.entity.js';
import { CouponBatch } from '../modules/promotions/entities/coupon-batch.entity.js';
import { PromotionCoupon } from '../modules/promotions/entities/promotion-coupon.entity.js';
import { PromotionUsage } from '../modules/promotions/entities/promotion-usage.entity.js';
import { PromotionUsageCounter } from '../modules/promotions/entities/promotion-usage-counter.entity.js';
import { ShoppingList } from '../modules/shopping_lists/entities/shopping-list.entity.js';
import { ShoppingListItem } from '../modules/shopping_lists/entities/shopping-list-item.entity.js';
import { SettingGroup } from '../kernel/settings/setting-group.entity.js';
import { Setting } from '../kernel/settings/setting.entity.js';
import { SettingValue } from '../kernel/settings/setting-value.entity.js';
import { SearchPhraseRecord } from '../modules/search/entities/search-phrase-record.entity.js';
import { Comparison } from '../modules/comparisons/entities/comparison.entity.js';
import { ComparisonProduct } from '../modules/comparisons/entities/comparison-product.entity.js';
import { QuoteRequestRevision } from '../modules/quote_requests/entities/quote-request-revision.entity.js';
import { QuoteRequestEvent } from '../modules/quote_requests/entities/quote-request-event.entity.js';
import { QuoteRequestNotificationEvent } from '../modules/quote_requests/entities/quote-request-notification-event.entity.js';
import { OrganizationSalesRepAssignment } from '../modules/organizations/entities/organization-sales-rep-assignment.entity.js';
import { Warehouse } from '../modules/inventory/entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../modules/inventory/entities/warehouse-channel-assignment.entity.js';
import { InventoryThreshold } from '../modules/inventory/entities/inventory-threshold.entity.js';
import { ProductWarehouseLowStockThreshold } from '../modules/inventory/entities/product-warehouse-low-stock-threshold.entity.js';
import { StockAllocation } from '../modules/inventory/entities/stock-allocation.entity.js';
import { ModuleRegistration } from '../modules/_lifecycle/entities/module-registration.entity.js';
import { TranslationBundle } from '../modules/_i18n/entities/translation-bundle.entity.js';
import { ModuleAction } from '../modules/admin_actions/entities/module-action.entity.js';
import { CredentialConfiguration } from '../modules/credentials/entities/credential-configuration.entity.js';
import { KsefCredential } from '../modules/ksef/entities/ksef-credential.entity.js';
import { KsefSubmission } from '../modules/ksef/entities/ksef-submission.entity.js';
import { FeedTemplate } from '../modules/product_feeds/entities/feed-template.entity.js';
import { FeedTemplateField } from '../modules/product_feeds/entities/feed-template-field.entity.js';
import { ProductFeed } from '../modules/product_feeds/entities/product-feed.entity.js';
import { FeedRun } from '../modules/product_feeds/entities/feed-run.entity.js';
import { FeedRunIssue } from '../modules/product_feeds/entities/feed-run-issue.entity.js';
import { FeedArtefact } from '../modules/product_feeds/entities/feed-artefact.entity.js';
import { FeedTaxonomy } from '../modules/product_feeds/entities/feed-taxonomy.entity.js';
import { FeedTaxonomyNode } from '../modules/product_feeds/entities/feed-taxonomy-node.entity.js';
import { FeedTaxonomyMapping } from '../modules/product_feeds/entities/feed-taxonomy-mapping.entity.js';
import { FeedTaxonomyCheck } from '../modules/product_feeds/entities/feed-taxonomy-check.entity.js';
import { FeedDelivery } from '../modules/product_feeds/entities/feed-delivery.entity.js';
import { FeedDeliveryAttempt } from '../modules/product_feeds/entities/feed-delivery-attempt.entity.js';
import { ErgonodeConnection } from '../modules/pim_ergonode/entities/ergonode-connection.entity.js';
import { ErgonodeStreamCursor } from '../modules/pim_ergonode/entities/ergonode-stream-cursor.entity.js';
import { ErgonodeAttributeMapping } from '../modules/pim_ergonode/entities/ergonode-attribute-mapping.entity.js';
import { ErgonodeCategoryMapping } from '../modules/pim_ergonode/entities/ergonode-category-mapping.entity.js';
import { ErgonodePriceBinding } from '../modules/pim_ergonode/entities/ergonode-price-binding.entity.js';
import { ErgonodeProductLink } from '../modules/pim_ergonode/entities/ergonode-product-link.entity.js';
import { ErgonodeMediaLink } from '../modules/pim_ergonode/entities/ergonode-media-link.entity.js';
import { ErgonodeFieldProtection } from '../modules/pim_ergonode/entities/ergonode-field-protection.entity.js';
import { ErgonodeImportRun } from '../modules/pim_ergonode/entities/ergonode-import-run.entity.js';
import { ErgonodeImportIssue } from '../modules/pim_ergonode/entities/ergonode-import-issue.entity.js';

/**
 * Explicit entity registry consumed by `mikro-orm.config.ts`.
 *
 * We avoid the glob-based discovery (`entities: ['./dist/.../*.js']`) for the
 * same reason every modern ORM example does: glob discovery needs dynamic
 * `import()` at runtime, which Node's ESM loader can't transform TypeScript
 * through. Under Vitest's test loader that dynamic import fails with
 * `SyntaxError: Invalid or unexpected token` because the .ts file reaches the
 * Node loader without esbuild transformation. Listing the classes explicitly
 * side-steps the whole problem.
 *
 * Every new module entity MUST be added here. Ownership still belongs to the
 * module folder — this file is just the composition root's import list.
 */

export const ALL_ENTITIES = [
  // auth
  Session,
  // audit_logs
  AuditLogEntry,
  // assets_library (feature 013, supersedes legacy `assets`)
  Asset,
  AssetFolder,
  // catalog
  Product,
  ProductVariant,
  Category,
  ProductAttribute,
  // per-channel + per-language overrides (feature 022)
  ProductValueOverride,
  ProductEditorPreference,
  // Queued product bulk-edit operations
  BulkOperation,
  // Attribute Sets (feature 002)
  AttributeSet,
  AttributeSetAttribute,
  // Gallery (feature 002 US3)
  GalleryItem,
  GalleryItemLabel,
  // Attachments (feature 002 US3)
  AttachmentType,
  ProductAttachment,
  ProductLink,
  GroupedItem,
  // Packaging units (feature 043)
  ProductPackagingUnit,
  BundleSlot,
  BundleSlotOption,
  SalesChannel,
  // inventory
  AvailabilityNotification,
  // quote_requests
  QuoteRequest,
  QuoteRequestItem,
  // organizations + customer_accounts + addresses
  Organization,
  CustomerAccount,
  Address,
  CustomerAddress,
  EmailVerificationToken,
  // carts + commerce
  Cart,
  CartItem,
  CartAuditEntry,
  StockLevel,
  DeliveryMethod,
  PaymentMethod,
  Order,
  OrderItem,
  OrderAppliedPromotion,
  OrderStatus,
  OrderStatusTransition,
  OrderComment,
  OrderListSavedView,
  OrderPlacementIntent,
  // Feature 046 — Returns & Complaints (Refunds, RMA).
  ReturnStatus,
  ReturnStatusTransition,
  ReturnCase,
  ReturnCaseItem,
  ReturnCaseComment,
  ReturnReason,
  ReturnDeliveryMethod,
  Refund,
  ReturnShipment,
  ReturnCaseAttachment,
  ReturnListSavedView,
  Payment,
  Shipment,
  Invoice,
  InvoiceLine,
  InvoiceNumberCounter,
  InvoiceTemplate,
  // organization invitations (US3)
  OrganizationInvitation,
  // admin (US4)
  AdminUser,
  AdminRole,
  // password reset (polish)
  PasswordResetToken,
  // credit limits (US6)
  CreditLimit,
  CreditLimitReservation,
  // US7 — API keys, webhooks
  ApiKey,
  Webhook,
  WebhookDelivery,
  // analytics (Phase 10 / T237)
  AnalyticsEvent,
  // seo (Phase 10 / T235)
  SeoMetaOverride,
  SitemapCache,
  // languages + currencies (Phase 10 / T238)
  Language,
  Currency,
  // cms (feature 014, supersedes legacy cms_pages)
  CmsPage,
  CmsBlock,
  CmsTemplate,
  CmsHook,
  CmsHookBlockAttachment,
  // megamenu (feature 015)
  Megamenu,
  MegamenuItem,
  MegamenuBinding,
  // blog (feature 016)
  BlogCategory,
  BlogCategorySalesChannel,
  BlogCategoryLanguage,
  BlogPost,
  BlogPostSalesChannel,
  BlogPostLanguage,
  BlogPostCategory,
  BlogPostTag,
  BlogPostRelatedPost,
  BlogPostRelatedProduct,
  BlogTag,
  // dictionary (feature 017)
  Country,
  DictionaryTranslation,
  LanguageCountry,
  // pricing (Phase 4 polish / T127)
  CustomerGroup,
  PriceList,
  // pricing engine (feature 011)
  PriceListProduct,
  PriceListPriceBracket,
  PriceDisplayModeOverride,
  // taxes + promotions (Phase 4 polish / T128, T129)
  Tax,
  Promotion,
  // promotions engine (feature 045)
  PromotionRuleEntity,
  CouponBatch,
  PromotionCoupon,
  PromotionUsage,
  PromotionUsageCounter,
  // shopping lists (US5 / T200)
  ShoppingList,
  ShoppingListItem,
  // settings (feature 004)
  SettingGroup,
  Setting,
  SettingValue,
  // credentials (feature 058)
  CredentialConfiguration,
  // ksef (feature 059)
  KsefCredential,
  KsefSubmission,
  // product_feeds (feature 067)
  FeedTemplate,
  FeedTemplateField,
  ProductFeed,
  FeedRun,
  FeedRunIssue,
  FeedArtefact,
  FeedTaxonomy,
  FeedTaxonomyNode,
  FeedTaxonomyMapping,
  FeedTaxonomyCheck,
  // product_feeds delivery (feature 070)
  FeedDelivery,
  FeedDeliveryAttempt,
  // pim_ergonode (feature 068)
  ErgonodeConnection,
  ErgonodeStreamCursor,
  ErgonodeAttributeMapping,
  ErgonodeCategoryMapping,
  ErgonodePriceBinding,
  ErgonodeProductLink,
  ErgonodeMediaLink,
  ErgonodeFieldProtection,
  ErgonodeImportRun,
  ErgonodeImportIssue,
  // search analytics ingest (feature 006 / US3)
  SearchPhraseRecord,
  // comparisons (feature 007)
  Comparison,
  ComparisonProduct,
  // quote_requests workflow (feature 008)
  QuoteRequestRevision,
  QuoteRequestEvent,
  QuoteRequestNotificationEvent,
  OrganizationSalesRepAssignment,
  // inventory multi-warehouse (feature 010)
  Warehouse,
  WarehouseChannelAssignment,
  InventoryThreshold,
  ProductWarehouseLowStockThreshold,
  StockAllocation,
  // module lifecycle registry (feature 018)
  ModuleRegistration,
  // admin UI i18n bundles (feature 019)
  TranslationBundle,
  // module-contributed admin command palette actions (feature 020)
  ModuleAction,
  // organizations consolidation (feature 026)
  OrganizationTaxIdValidation,
  OrganizationPaymentMethodLink,
  OrganizationDeliveryMethodLink,
  OrganizationWarehouseLink,
  // admin notifications "bell" surface (feature 026)
  AdminNotification,
  AdminNotificationRead,
  // quick-order default ordering preferences (feature 039)
  QuickOrderDefaultPreference,
  // MFA — 2FA enrolment, recovery codes, social identities, org policy (feature 042)
  MfaEnrolment,
  MfaRecoveryCode,
  MfaSocialIdentity,
  MfaOrganizationPolicy,
  PromptActionRequest,
  // PWA — push subscriptions/messages/deliveries + derived icon renditions (feature 046)
  PushSubscription,
  PushMessage,
  PushMessageDelivery,
  PwaIconRendition,
  // transactional emails (feature 047)
  TransactionalEmail,
  TransactionalEmailContent,
  EmailBlock,
  EmailBlockSalesChannel,
  EmailTemplate,
  EmailTemplateSalesChannel,
  // newsletter (feature 048)
  NewsletterSubscriber,
  NewsletterTag,
  NewsletterSubscriberTag,
  NewsletterCustomField,
  NewsletterSuppression,
  NewsletterEmailBlock,
  NewsletterEmailBlockSalesChannel,
  NewsletterCampaign,
  NewsletterCampaignSubscriber,
  NewsletterSendRecord,
  NewsletterEngagementEvent,
  NewsletterAutomation,
  NewsletterAutomationRun,
  GaCustomEvent,
  LinkedInConversionMapping,
  MetaCustomEventMapping,
  // Stripe payment gateway (feature 049)
  StripeCustomer,
  StripeSavedCard,
  StripePaymentIntent,
  StripeWebhookEvent,
  StripePaymentMethodRule,
  StripePaymentMethodOrgDisable,
  // TPay payment gateway (feature 063)
  TpayTransaction,
  TpayNotificationEvent,
  TpaySavedCard,
  TpayBlikAlias,
  TpayPaymentMethodRule,
  TpayPaymentMethodOrgDisable,
  PayuOrder,
  PayuNotificationEvent,
  PayuSavedCard,
  PayuBlikAlias,
  PayuPaymentMethodRule,
  PayuPaymentMethodOrgDisable,
  AutopayTransaction,
  AutopayNotificationEvent,
  AutopaySavedCard,
  AutopayBlikAlias,
  AutopayPaymentMethodRule,
  AutopayPaymentMethodOrgDisable,
  // Feature 055 — Custom Fields Layer (entity-agnostic runtime fields).
  CustomFieldDefinition,
  CustomFieldOption,
] as const;
