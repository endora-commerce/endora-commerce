// @endora-commerce/contracts — source-of-truth Zod schemas for every API boundary of the B2B platform.
//
// Per Principle V of the constitution, this package is the ONLY place where request/response
// shapes are defined. The backend regenerates its live OpenAPI document from here at startup
// (see research.md R-05). TypeScript types consumed by the backend, storefront, and admin are
// inferred from these schemas via `z.infer`; they are not maintained by hand.
//
// Module-specific schemas are added by each user-story phase in tasks.md
// (catalog.ts, quote-requests.ts, organizations.ts, orders.ts, credit-limits.ts, …).

export * from './errors.js';
export * from './envelopes.js';
export * from './pagination.js';
export * from './common.js';
export * from './catalog.js';
export * from './quote-requests.js';
export * from './organizations.js';
export * from './customers.js';
export * from './carts.js';
export * from './orders.js';
export * from './returns.js';
export * from './price-lists.js';
export * from './taxes.js';
export * from './promotions.js';
export * from './inventory.js';
export * from './invoices.js';
export * from './payments.js';
export * from './payment-methods.js';
export * from './payment-return-url.js';
export * from './stripe.js';
export * from './tpay.js';
export * from './payu.js';
export * from './autopay.js';
export * from './paypal.js';
export * from './dhl-parcel.js';
export * from './shipping-methods.js';
export * from './admin.js';
export * from './credit-limits.js';
export * from './api-keys.js';
export * from './webhooks.js';
export * from './analytics.js';
export * from './seo.js';
export * from './i18n.js';
export * from './platform-language.js';
export * from './admin-i18n.js';
export * from './cms-pages.js';
export {
  cmsContentEnvelopeSchema,
  cmsPageSummarySchema,
  cmsPageDetailSchema,
  createCmsPageRequestSchema,
  patchCmsPageRequestSchema,
  putCmsPageContentRequestSchema,
  cmsBlockSummarySchema,
  cmsBlockDetailSchema,
  createCmsBlockRequestSchema,
  patchCmsBlockRequestSchema,
  cmsTemplateSummarySchema,
  cmsTemplateDetailSchema,
  createCmsTemplateRequestSchema,
  patchCmsTemplateRequestSchema,
  cmsHookSummarySchema,
  cmsHookDetailSchema,
  createCmsHookRequestSchema,
  patchCmsHookRequestSchema,
  cmsHookAttachmentRequestSchema,
  cmsFieldDescriptorSchema,
  cmsPageBuilderDescriptorSchema,
  cmsColorPaletteEntrySchema,
  cmsColorPaletteSchema,
  putCmsColorPaletteRequestSchema,
  cmsAssetEmbedResolutionSchema,
  cmsResolvedBlockSchema,
  cmsResolvedTemplateSchema,
  cmsResolvedPageSchema,
  cmsResolvedHookSchema,
  type CmsContentEnvelope,
  type CmsPageSummary,
  type CmsPageDetail,
  type CreateCmsPageRequest,
  type PatchCmsPageRequest,
  type PutCmsPageContentRequest,
  type CmsBlockSummary,
  type CmsBlockDetail,
  type CreateCmsBlockRequest,
  type PatchCmsBlockRequest,
  type CmsTemplateSummary,
  type CmsTemplateDetail,
  type CreateCmsTemplateRequest,
  type PatchCmsTemplateRequest,
  type CmsHookSummary,
  type CmsHookDetail,
  type CreateCmsHookRequest,
  type PatchCmsHookRequest,
  type CmsHookAttachmentRequest,
  type CmsFieldDescriptor,
  type CmsPageBuilderDescriptor,
  type CmsColorPaletteEntry,
  type CmsColorPalette,
  type PutCmsColorPaletteRequest,
  type CmsAssetEmbedResolution,
  type CmsResolvedBlock,
  type CmsResolvedTemplate,
  type CmsResolvedPage,
  type CmsResolvedHook,
  // Feature 075, Phase P — the in-process port surface. Named here like every
  // other `cms` export because this file re-exports the module explicitly to
  // resolve name collisions.
  type CmsReference,
  type CmsExternalReferenceScanner,
  type CmsReferenceRegistryPort,
  type CmsPageRecord,
  type CmsPageReadPort,
  type CmsSeededBlock,
  type CmsBlockSeedPort,
} from './cms.js';
export * from './shopping-lists.js';
export * from './quick-order.js';
export * from './settings.js';
export * from './sales-channels.js';
export * from './search.js';
export * from './comparisons.js';
export * from './assets-library.js';
export * from './megamenu.js';
export * from './blog.js';
export * from './dictionary.js';
export * from './modules.js';
export * from './admin-actions.js';
export * from './product-scope-overrides.js';
export * from './product-value-resolver.js';
export * from './mfa.js';
export * from './prompt-actions.js';
export * from './pwa.js';
export * from './email.js';
export * from './transactional-emails.js';
export * from './newsletter.js';
export * from './google-analytics.js';
export * from './linkedin-ads.js';
export * from './meta-ads.js';
export * from './google-tag-manager.js';
export * from './custom-fields.js';
export * from './credentials.js';
export * from './ksef.js';
export * from './product-feeds.js';
export * from './pim-ergonode.js';
export * from './kernel.js';
// Port contracts published by feature 075's Phase P for providers that had no
// contracts file of their own.
export * from './auth.js';
export * from './customer-accounts.js';
export * from './email.js';
export * from './languages.js';
export * from './currencies.js';
export * from './admin-roles.js';
export * from './admin-users.js';
export * from './addresses.js';
export * from './shipments.js';
export * from './admin-notifications.js';
// The audit-log reference registry (feature 075, D-87 drain). Not an API shape:
// the in-process seam each module answers "what is this row of mine called, and
// where does the admin app show it?" through.
export * from './audit-logs.js';
// The bulk-import report both owners answer in and `import_export` renders
// (feature 075, D-74). Not a module's port surface — a shape two of them share.
export * from './import-export.js';
// The one diacritic fold, reachable from every package (issue #240). Not an API
// shape: a pure text utility that was correct and unfindable inside
// `normalizeOrganizationName` until six copies of it had been written.
export * from './text-normalization.js';
// The one e-mail fold. Not an API shape either: the rule that an address is
// stored and compared in one form, reachable by both modules that key a row on
// one.
export * from './email-address.js';
