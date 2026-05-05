import { Session } from '../modules/auth/entities/session.entity.js';
import { AuditLogEntry } from '../modules/audit_logs/entities/audit-log-entry.entity.js';
import { Asset } from '../modules/assets_library/entities/asset.entity.js';
import { AssetFolder } from '../modules/assets_library/entities/asset-folder.entity.js';
import { Product } from '../modules/catalog/entities/product.entity.js';
import { ProductVariant } from '../modules/catalog/entities/product-variant.entity.js';
import { Category } from '../modules/catalog/entities/category.entity.js';
import { ProductAttribute } from '../modules/catalog/entities/product-attribute.entity.js';
import { AttributeOption } from '../modules/catalog/entities/attribute-option.entity.js';
import { AttributeSet } from '../modules/catalog/entities/attribute-set.entity.js';
import { AttributeSetAttribute } from '../modules/catalog/entities/attribute-set-attribute.entity.js';
import { GalleryItem } from '../modules/catalog/entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../modules/catalog/entities/gallery-item-label.entity.js';
import { AttachmentType } from '../modules/catalog/entities/attachment-type.entity.js';
import { ProductAttachment } from '../modules/catalog/entities/product-attachment.entity.js';
import { ProductLink } from '../modules/catalog/entities/product-link.entity.js';
import { GroupedItem } from '../modules/catalog/entities/grouped-item.entity.js';
import { BundleSlot } from '../modules/catalog/entities/bundle-slot.entity.js';
import { BundleSlotOption } from '../modules/catalog/entities/bundle-slot-option.entity.js';
import { SalesChannel } from '../modules/sales_channels/entities/sales-channel.entity.js';
import { AvailabilityNotification } from '../modules/inventory/entities/availability-notification.entity.js';
import { QuoteRequest } from '../modules/quote_requests/entities/quote-request.entity.js';
import { QuoteRequestItem } from '../modules/quote_requests/entities/quote-request-item.entity.js';
import { Organization } from '../modules/organizations/entities/organization.entity.js';
import { CustomerAccount } from '../modules/customer_accounts/entities/customer-account.entity.js';
import { Address } from '../modules/addresses/entities/address.entity.js';
import { EmailVerificationToken } from '../modules/organizations/entities/email-verification-token.entity.js';
import { Cart } from '../modules/carts/entities/cart.entity.js';
import { CartItem } from '../modules/carts/entities/cart-item.entity.js';
import { StockLevel } from '../modules/inventory/entities/stock-level.entity.js';
import { DeliveryMethod } from '../modules/delivery_methods/entities/delivery-method.entity.js';
import { PaymentMethod } from '../modules/payment_methods/entities/payment-method.entity.js';
import { Order } from '../modules/orders/entities/order.entity.js';
import { OrderItem } from '../modules/orders/entities/order-item.entity.js';
import { Payment } from '../modules/payments/entities/payment.entity.js';
import { Invoice } from '../modules/invoices/entities/invoice.entity.js';
import { OrganizationInvitation } from '../modules/organizations/entities/organization-invitation.entity.js';
import { AdminUser } from '../modules/admin_users/entities/admin-user.entity.js';
import { AdminRole } from '../modules/admin_roles/entities/admin-role.entity.js';
import { PasswordResetToken } from '../modules/customer_accounts/entities/password-reset-token.entity.js';
import { CreditLimit } from '../modules/credit_limits/entities/credit-limit.entity.js';
import { CreditLimitReservation } from '../modules/credit_limits/entities/credit-limit-reservation.entity.js';
import { ApiKey } from '../modules/api_keys/entities/api-key.entity.js';
import { Webhook } from '../modules/webhooks/entities/webhook.entity.js';
import { WebhookDelivery } from '../modules/webhooks/entities/webhook-delivery.entity.js';
import { ExternalIntegration } from '../modules/integrations/entities/external-integration.entity.js';
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
import { CustomerGroup } from '../modules/price_lists/entities/customer-group.entity.js';
import { PriceList } from '../modules/price_lists/entities/price-list.entity.js';
import { PriceListProduct } from '../modules/price_lists/entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../modules/price_lists/entities/price-list-price-bracket.entity.js';
import { PriceDisplayModeOverride } from '../modules/price_lists/entities/price-display-mode-override.entity.js';
import { Tax } from '../modules/taxes/entities/tax.entity.js';
import { Promotion } from '../modules/promotions/entities/promotion.entity.js';
import { ShoppingList } from '../modules/shopping_lists/entities/shopping-list.entity.js';
import { ShoppingListItem } from '../modules/shopping_lists/entities/shopping-list-item.entity.js';
import { SettingGroup } from '../modules/settings/entities/setting-group.entity.js';
import { Setting } from '../modules/settings/entities/setting.entity.js';
import { SettingValue } from '../modules/settings/entities/setting-value.entity.js';
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
import { StockAllocation } from '../modules/inventory/entities/stock-allocation.entity.js';

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
  AttributeOption,
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
  EmailVerificationToken,
  // carts + commerce
  Cart,
  CartItem,
  StockLevel,
  DeliveryMethod,
  PaymentMethod,
  Order,
  OrderItem,
  Payment,
  Invoice,
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
  // US7 — API keys, webhooks, integrations
  ApiKey,
  Webhook,
  WebhookDelivery,
  ExternalIntegration,
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
  // shopping lists (US5 / T200)
  ShoppingList,
  ShoppingListItem,
  // settings (feature 004)
  SettingGroup,
  Setting,
  SettingValue,
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
  StockAllocation,
] as const;
