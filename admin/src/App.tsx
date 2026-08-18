import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { LoginPage } from './components/LoginPage.js';
import { IdleLogout } from './components/IdleLogout.js';
import { useAuth } from './lib/auth.js';
import { TranslationProvider } from './i18n/TranslationProvider.js';
import { useTranslation } from './i18n/useTranslation.js';
import { appBootstrapCopy } from './i18n/preauth-login-copy.js';
import { AdminActionsProvider } from './lib/admin-actions/AdminActionsProvider.js';
import { ModulePresenceProvider } from './lib/module-presence';
import { AppLanguageContext } from './i18n/app-language-context.js';
import { registryRoutes } from './lib/module-registry/index.js';
import {
  useSurfaceVisibility,
  type GatedSurface,
  type PermissionRequirement,
} from './lib/surface-visibility.js';
import type { SupportedAdminLanguage } from './i18n/types.js';
import { ApiKeysPage } from './modules/api_keys/ApiKeysPage.js';
import { WebhooksPage } from './modules/webhooks/WebhooksPage.js';
import { SeoPage } from './modules/seo/SeoPage.js';
import { DictionaryPage } from './modules/dictionaries/DictionaryPage.js';
import { DictionaryAuditPage } from './modules/dictionaries/AuditPage.js';
import { PagesListPage } from './modules/cms/pages/PagesListPage.js';
import { PageEditor } from './modules/cms/editors/PageEditor.js';
import { BlocksListPage } from './modules/cms/pages/BlocksListPage.js';
import { BlockEditor } from './modules/cms/editors/BlockEditor.js';
import { TemplatesListPage } from './modules/cms/pages/TemplatesListPage.js';
import { TemplateEditor } from './modules/cms/editors/TemplateEditor.js';
import { HooksPage } from './modules/cms/pages/HooksPage.js';
import { MegamenuListPage } from './modules/megamenu/pages/MegamenuListPage.js';
import { MegamenuEditor } from './modules/megamenu/pages/MegamenuEditor.js';
import { BlogPostListPage } from './modules/blog/pages/BlogPostListPage.js';
import { BlogPostEditor } from './modules/blog/pages/BlogPostEditor.js';
import { BlogCategoryTreePage } from './modules/blog/pages/BlogCategoryTreePage.js';
import { BlogCategoryEditor } from './modules/blog/pages/BlogCategoryEditor.js';
import { BlogTagListPage } from './modules/blog/pages/BlogTagListPage.js';
import { RfqList } from './modules/quote_requests/RfqList.js';
import { RfqCreatePage } from './modules/quote_requests/RfqCreatePage.js';
import { RfqDetail } from './modules/quote_requests/RfqDetail.js';
import { ProductsList } from './modules/catalog/ProductsList.js';
import { ProductEditor } from './modules/catalog/ProductEditor.js';
import { CategoriesTree } from './modules/catalog/CategoriesTree.js';
import { AttributesManager } from './modules/catalog/AttributesManager.js';
import { AttributeSetsPage } from './modules/catalog/AttributeSetsPage.js';
import { AttachmentTypesPage } from './modules/catalog/AttachmentTypesPage.js';
import { BulkOperationsPage } from './modules/catalog/BulkOperationsPage.js';
import { BulkOperationDetailPage } from './modules/catalog/BulkOperationDetailPage.js';
import { LibraryPage as AssetsLibraryPage } from './modules/assets_library/pages/LibraryPage.js';
import { OrganizationsList } from './modules/organizations/OrganizationsList.js';
import { OrganizationDetail } from './modules/organizations/OrganizationDetail.js';
import { CustomersList } from './modules/customers/CustomersList.js';
import { CustomerDetail } from './modules/customers/CustomerDetail.js';
import { OnlineCustomers } from './modules/customers/OnlineCustomers.js';
import { CustomerGroupsPage } from './modules/customer_accounts/CustomerGroupsPage.js';
import { OrdersList } from './modules/orders/OrdersList.js';
import { OrderDetail } from './modules/orders/OrderDetail.js';
import { OrderStatusConfigPage } from './modules/orders/OrderStatusConfigPage.js';
import { ReturnsList } from './modules/returns/ReturnsList.js';
import { ReturnDetail } from './modules/returns/ReturnDetail.js';
import { EmailsList } from './modules/transactional_emails/pages/EmailsList.js';
import { EmailEditor } from './modules/transactional_emails/pages/EmailEditor.js';
import { EmailBlocksPage } from './modules/transactional_emails/pages/EmailBlocksPage.js';
import { EmailTemplatesPage } from './modules/transactional_emails/pages/EmailTemplatesPage.js';
import { EmailFragmentEditor } from './modules/transactional_emails/pages/EmailFragmentEditor.js';
import { SubscribersPage as NewsletterSubscribersPage } from './modules/newsletter/pages/SubscribersPage.js';
import { CampaignsPage as NewsletterCampaignsPage } from './modules/newsletter/pages/CampaignsPage.js';
import { CampaignEditor as NewsletterCampaignEditor } from './modules/newsletter/pages/CampaignEditor.js';
import { AutomationsPage as NewsletterAutomationsPage } from './modules/newsletter/pages/AutomationsPage.js';
import { AutomationBuilder as NewsletterAutomationBuilder } from './modules/newsletter/pages/AutomationBuilder.js';
import { TagsPage as NewsletterTagsPage } from './modules/newsletter/pages/TagsPage.js';
import { CampaignStats as NewsletterCampaignStats } from './modules/newsletter/pages/CampaignStats.js';
import { BlocksPage as NewsletterBlocksPage } from './modules/newsletter/pages/BlocksPage.js';
import { ProviderSettingsPage as NewsletterProviderPage } from './modules/newsletter/pages/ProviderSettingsPage.js';
import { ReturnStatusesConfigPage } from './modules/returns/ReturnStatusesConfigPage.js';
import { ReturnReasonsPage } from './modules/returns/ReturnReasonsPage.js';
import { CustomFieldsPage } from './modules/custom_fields/CustomFieldsPage.js';
import { ReturnDeliveryMethodsPage } from './modules/returns/ReturnDeliveryMethodsPage.js';
import { OrderCreatePage } from './modules/orders/OrderCreatePage.js';
import { QuickOrderOnBehalfPage } from './modules/quick_order/QuickOrderOnBehalfPage.js';
import { InvoicesList } from './modules/invoices/InvoicesList.js';
import { InvoiceDetail } from './modules/invoices/InvoiceDetail.js';
import { InvoiceTemplatesPage } from './modules/invoices/templates/InvoiceTemplatesPage.js';
import { KsefPage } from './modules/ksef/pages/KsefPage.js';
import { ProductFeedsListPage } from './modules/product_feeds/ProductFeedsListPage.js';
import { ProductFeedCreatePage } from './modules/product_feeds/ProductFeedCreatePage.js';
import { ProductFeedDetailPage } from './modules/product_feeds/ProductFeedDetailPage.js';
import { FeedTemplatesListPage } from './modules/product_feeds/FeedTemplatesListPage.js';
import { FeedTemplateStartFromPage } from './modules/product_feeds/FeedTemplateStartFromPage.js';
import { FeedTemplateEditorPage } from './modules/product_feeds/FeedTemplateEditorPage.js';
import { FeedTemplateImportPage } from './modules/product_feeds/FeedTemplateImportPage.js';
import { FeedRunDetailPage } from './modules/product_feeds/FeedRunDetailPage.js';
import { CategoryMappingPage } from './modules/product_feeds/CategoryMappingPage.js';
import { TaxonomyRevisionsPage } from './modules/product_feeds/TaxonomyRevisionsPage.js';
import { ErgonodeConnectionPage } from './modules/pim_ergonode/ErgonodeConnectionPage.js';
import { ErgonodeAttributeMappingPage } from './modules/pim_ergonode/ErgonodeAttributeMappingPage.js';
import { ErgonodeCategoryMappingPage } from './modules/pim_ergonode/ErgonodeCategoryMappingPage.js';
import { ErgonodeRunsPage } from './modules/pim_ergonode/ErgonodeRunsPage.js';
import { ErgonodeRunDetailPage } from './modules/pim_ergonode/ErgonodeRunDetailPage.js';
import { PimcoreConnectionPage } from './modules/pim_pimcore/PimcoreConnectionPage.js';
import { PimcoreRunsPage } from './modules/pim_pimcore/PimcoreRunsPage.js';
import { PimcoreRunDetailPage } from './modules/pim_pimcore/PimcoreRunDetailPage.js';
import { InvoiceTemplateEditor } from './modules/invoices/templates/InvoiceTemplateEditor.js';
import { TaxesPage } from './modules/taxes/TaxesPage.js';
import { PromotionsPage } from './modules/promotions/PromotionsPage.js';
import { PromotionEditPage } from './modules/promotions/PromotionEditPage.js';
import { PromotionRulesPage } from './modules/promotions/PromotionRulesPage.js';
import { PromotionStatsPage } from './modules/promotions/PromotionStatsPage.js';
import { PriceListsPage } from './modules/price_lists/PriceListsPage.js';
import { PriceListDetailPage } from './modules/price_lists/PriceListDetailPage.js';
import { DisplayModeOverridesPage } from './modules/price_lists/DisplayModeOverridesPage.js';
import { HomePage } from './modules/home/HomePage.js';
import { DeliveryMethodsPage } from './modules/delivery_methods/DeliveryMethodsPage.js';
import { PaymentMethodsPage } from './modules/payment_methods/PaymentMethodsPage.js';
import { CredentialsPage } from './modules/credentials/pages/CredentialsPage.js';
import { InventoryPage } from './modules/inventory/InventoryPage.js';
import { LowStockPage } from './modules/inventory/LowStockPage.js';
import { AvailabilityNotificationsPage } from './modules/inventory/AvailabilityNotificationsPage.js';
import { StockImportWizard } from './modules/inventory/StockImportWizard.js';
import { WarehousesList } from './modules/warehouses/WarehousesList.js';
import { WarehouseEditor } from './modules/warehouses/WarehouseEditor.js';
import { CreditLimitsPage } from './modules/credit_limits/CreditLimitsPage.js';
import { ModulesPage as PlatformModulesPage } from './modules/platform/ModulesPage.js';
import { SettingsPage } from './modules/settings/pages/SettingsPage.js';
import { GroupsPage as SettingsGroupsPage } from './modules/settings/pages/GroupsPage.js';
import { CachePage } from './modules/settings/pages/CachePage.js';
import { PwaPage } from './modules/settings/pages/PwaPage.js';
import { SalesChannelsListPage } from './modules/sales_channels/pages/SalesChannelsListPage.js';
import { SalesChannelEditPage } from './modules/sales_channels/pages/SalesChannelEditPage.js';
import { ComparisonsListPage } from './modules/comparisons/pages/ComparisonsListPage.js';
import { ComparisonDetailPage } from './modules/comparisons/pages/ComparisonDetailPage.js';
import { ProfilePage } from './modules/profile/ProfilePage.js';

function NotFoundPage(): ReactNode {
  const t = useTranslation('core');
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      {t('app.notFound')}
    </div>
  );
}

/**
 * One module-contributed route, gated and lazily loaded (feature 091, FR-011).
 *
 * **The gate is here and not in the module**, which is the whole reason a
 * contribution is a declaration rather than a component. `useSurfaceVisibility`
 * is the one predicate the sidebar, the palette and the dashboard already share
 * (issue #230 — three surfaces answering the visibility question three ways),
 * and it reads the server's effective enabled-set, so an operator switching a
 * module off withdraws its screens without a rebuild. A module that gated its
 * own screen would be a fourth answer, in a package, where nothing could see it
 * drift.
 *
 * A hidden route renders the admin's own not-found treatment rather than a
 * blank frame: an operator following a stale deep-link into a module their role
 * cannot open, or into one that is switched off, gets the same answer as any
 * other unknown path — which is what the surface is already telling them by not
 * listing it.
 */
function ModuleRoute({
  module,
  requiredPermission,
  load,
}: {
  module: string;
  requiredPermission: PermissionRequirement | undefined;
  load: () => Promise<{ readonly default: unknown }>;
}): ReactNode {
  const isVisible = useSurfaceVisibility();
  // `lazy` is memoised per mounted route: calling it on every render would
  // build a new component type each time and remount the screen underneath the
  // operator, losing their form state.
  const Screen = useMemo(
    () => lazy(async () => ({ default: (await load()).default as ComponentType })),
    [load],
  );
  // `exactOptionalPropertyTypes` is on, so an absent requirement is an absent
  // property rather than an explicit `undefined` — the distinction the flag
  // exists for, and the reason this is a spread and not a field.
  const surface: GatedSurface = {
    module,
    ...(requiredPermission === undefined ? {} : { requiredPermission }),
  };
  if (!isVisible(surface)) return <NotFoundPage />;
  return (
    <Suspense fallback={<ModuleScreenFallback />}>
      <Screen />
    </Suspense>
  );
}

/** The frame shown while a module's chunk is in flight. */
function ModuleScreenFallback(): ReactNode {
  const t = useTranslation('core');
  return <p className="text-sm text-muted-foreground">{t('app.moduleScreenLoading')}</p>;
}

export function App(): ReactNode {
  const { status, me } = useAuth();
  // Feature 019 — admin-side language state. Seeded from the session
  // payload's `preferredLanguage`; falls back to English (FR-003).
  // Lives at App scope so changes to it (driven by ProfilePage's
  // language selector) re-render the whole authenticated tree.
  const initialLanguage = (me?.adminUser.preferredLanguage ?? 'en') as SupportedAdminLanguage;
  const [language, setLanguage] = useState<SupportedAdminLanguage>(initialLanguage);

  // `useState` reads `initialLanguage` only on first mount, when `me` is
  // still null (auth is loading) — so without this sync the language is
  // locked to 'en' even when the session payload that arrives next carries
  // `preferredLanguage: 'pl'`. Re-sync whenever `me.preferredLanguage`
  // flips, but only when the user hasn't already chosen a different one
  // via ProfilePage in this same session.
  const sessionLanguage = me?.adminUser.preferredLanguage ?? null;
  useEffect(() => {
    if (sessionLanguage && sessionLanguage !== language) {
      setLanguage(sessionLanguage as SupportedAdminLanguage);
    }
    // We intentionally depend only on sessionLanguage — re-running on every
    // `language` change would clobber the user's in-session override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLanguage]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/40">
        <p className="text-sm text-muted-foreground">{appBootstrapCopy.loading}</p>
      </div>
    );
  }
  if (status === 'unauthenticated') return <LoginPage />;
  return (
    <TranslationProvider language={language}>
      <AppLanguageContext.Provider value={{ language, setLanguage }}>
        <ModulePresenceProvider>
        <AdminActionsProvider language={language}>
        {/* Auto sign-out after the configured inactivity window (default 60 min). */}
        <IdleLogout />
        <Routes>
          <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="/catalog/products" element={<ProductsList />} />
        <Route path="/catalog/products/:id" element={<ProductEditor />} />
        <Route path="/catalog/categories" element={<CategoriesTree />} />
        <Route path="/catalog/attributes" element={<AttributesManager />} />
        <Route path="/catalog/attribute-sets" element={<AttributeSetsPage />} />
        <Route path="/catalog/attachment-types" element={<AttachmentTypesPage />} />
        <Route path="/catalog/bulk-operations" element={<BulkOperationsPage />} />
        <Route path="/catalog/bulk-operations/:id" element={<BulkOperationDetailPage />} />
        <Route path="/assets-library" element={<AssetsLibraryPage />} />
        <Route path="/organizations" element={<OrganizationsList />} />
        <Route path="/organizations/:id" element={<OrganizationDetail />} />
        <Route path="/customers" element={<CustomersList />} />
        <Route path="/customers/online" element={<OnlineCustomers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/customer-groups" element={<CustomerGroupsPage />} />
        <Route path="/orders" element={<OrdersList />} />
        <Route path="/orders/new" element={<OrderCreatePage />} />
        <Route path="/orders/quick-order" element={<QuickOrderOnBehalfPage />} />
        <Route path="/orders/statuses" element={<OrderStatusConfigPage />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/custom-fields" element={<CustomFieldsPage />} />
        <Route path="/returns" element={<ReturnsList />} />
        <Route path="/returns/statuses" element={<ReturnStatusesConfigPage />} />
        <Route path="/returns/reasons" element={<ReturnReasonsPage />} />
        <Route path="/returns/delivery-methods" element={<ReturnDeliveryMethodsPage />} />
        <Route path="/returns/:id" element={<ReturnDetail />} />
        <Route path="/transactional-emails" element={<EmailsList />} />
        <Route path="/transactional-emails/blocks" element={<EmailBlocksPage />} />
        <Route path="/transactional-emails/blocks/:id" element={<EmailFragmentEditor kind="block" />} />
        <Route path="/transactional-emails/templates" element={<EmailTemplatesPage />} />
        <Route path="/transactional-emails/templates/:id" element={<EmailFragmentEditor kind="template" />} />
        <Route path="/transactional-emails/:code" element={<EmailEditor />} />
        <Route path="/newsletter/subscribers" element={<NewsletterSubscribersPage />} />
        <Route path="/newsletter/campaigns" element={<NewsletterCampaignsPage />} />
        <Route path="/newsletter/campaigns/new" element={<NewsletterCampaignEditor />} />
        <Route path="/newsletter/campaigns/:id" element={<NewsletterCampaignEditor />} />
        <Route path="/newsletter/campaigns/:id/stats" element={<NewsletterCampaignStats />} />
        <Route path="/newsletter/automations" element={<NewsletterAutomationsPage />} />
        <Route path="/newsletter/automations/new" element={<NewsletterAutomationBuilder />} />
        <Route path="/newsletter/automations/:id" element={<NewsletterAutomationBuilder />} />
        <Route path="/newsletter/tags" element={<NewsletterTagsPage />} />
        <Route path="/newsletter/blocks" element={<NewsletterBlocksPage />} />
        <Route path="/newsletter/provider" element={<NewsletterProviderPage />} />
        <Route path="/invoices" element={<InvoicesList />} />
        <Route path="/invoices/templates" element={<InvoiceTemplatesPage />} />
        <Route path="/invoices/templates/:id" element={<InvoiceTemplateEditor />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/ksef" element={<KsefPage />} />
        {/* Feature 067 — Product Feed. `/new` and `/templates` precede the
            parametric route so they are never captured as a feed id. */}
        <Route path="/product-feeds" element={<ProductFeedsListPage />} />
        <Route path="/product-feeds/new" element={<ProductFeedCreatePage />} />
        <Route path="/product-feeds/templates" element={<FeedTemplatesListPage />} />
        <Route path="/product-feeds/templates/new" element={<FeedTemplateStartFromPage />} />
        <Route path="/product-feeds/templates/import" element={<FeedTemplateImportPage />} />
        <Route
          path="/product-feeds/templates/:templateId"
          element={<FeedTemplateEditorPage />}
        />
        <Route path="/product-feeds/category-mapping" element={<CategoryMappingPage />} />
        <Route path="/product-feeds/taxonomy-revisions" element={<TaxonomyRevisionsPage />} />
        <Route
          path="/product-feeds/:feedId/runs/:runId"
          element={<FeedRunDetailPage />}
        />
        <Route path="/product-feeds/:feedId" element={<ProductFeedDetailPage />} />
        {/* Feature 068 — Ergonode PIM. Literal segments first, the parametric
            run route last, so a future `/pim-ergonode/:something` cannot swallow
            its siblings the way the feed routes once did. */}
        <Route path="/pim-ergonode" element={<ErgonodeConnectionPage />} />
        <Route
          path="/pim-ergonode/attribute-mappings"
          element={<ErgonodeAttributeMappingPage />}
        />
        <Route
          path="/pim-ergonode/category-mappings"
          element={<ErgonodeCategoryMappingPage />}
        />
        <Route path="/pim-ergonode/runs" element={<ErgonodeRunsPage />} />
        <Route path="/pim-ergonode/runs/:runId" element={<ErgonodeRunDetailPage />} />
        {/* Feature 076 — Pimcore PIM. Literal segments first, parametric run
            route last (same ordering rule as Ergonode). */}
        <Route path="/pim-pimcore" element={<PimcoreConnectionPage />} />
        <Route path="/pim-pimcore/runs" element={<PimcoreRunsPage />} />
        <Route path="/pim-pimcore/runs/:runId" element={<PimcoreRunDetailPage />} />
        <Route path="/taxes" element={<TaxesPage />} />
        <Route path="/promotions" element={<PromotionsPage />} />
        <Route path="/promotions/new" element={<PromotionEditPage />} />
        <Route path="/promotion-rules" element={<PromotionRulesPage />} />
        <Route path="/promotions/:id/stats" element={<PromotionStatsPage />} />
        <Route path="/promotions/:id" element={<PromotionEditPage />} />
        <Route path="/price-lists" element={<PriceListsPage />} />
        <Route path="/price-lists/display-modes" element={<DisplayModeOverridesPage />} />
        <Route path="/price-lists/:id" element={<PriceListDetailPage />} />
        <Route path="/delivery-methods" element={<DeliveryMethodsPage />} />
        {/*
          A redirect for the deep links that predate the screen's move to
          `/delivery-methods/dhl-parcel`, and the admin application's own:
          `dhl_parcel` declares the destination route in its own package since
          feature 091's Phase 4 batch five, and a `<Navigate>` is not that
          module's screen. It stays ungated deliberately — the destination is
          what `ModuleRoute` gates, so an operator who cannot reach the screen
          meets the admin's not-found treatment there rather than here.
        */}
        <Route path="/settings/dhl-parcel" element={<Navigate to="/delivery-methods/dhl-parcel" replace />} />
        <Route path="/payment-methods" element={<PaymentMethodsPage />} />
        <Route path="/credentials" element={<CredentialsPage />} />
        <Route path="/credentials/new" element={<CredentialsPage initialMode="new" />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/low-stock" element={<LowStockPage />} />
        <Route path="/inventory/notifications" element={<AvailabilityNotificationsPage />} />
        <Route path="/inventory/import" element={<StockImportWizard />} />
        <Route path="/warehouses" element={<WarehousesList />} />
        <Route path="/warehouses/new" element={<WarehouseEditor />} />
        <Route path="/warehouses/:id" element={<WarehouseEditor />} />
        <Route path="/credit-limits" element={<CreditLimitsPage />} />
        <Route path="/quote-requests" element={<RfqList />} />
        <Route path="/quote-requests/new" element={<RfqCreatePage />} />
        <Route path="/quote-requests/:id" element={<RfqDetail />} />
        <Route path="/comparisons" element={<ComparisonsListPage />} />
        <Route path="/comparisons/:id" element={<ComparisonDetailPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/seo" element={<SeoPage />} />
        <Route path="/dictionary" element={<DictionaryPage />} />
        <Route path="/dictionaries/audit" element={<DictionaryAuditPage />} />
        <Route path="/admin/dictionaries/audit" element={<DictionaryAuditPage />} />
        <Route path="/cms" element={<PagesListPage />} />
        <Route path="/cms/pages" element={<PagesListPage />} />
        <Route path="/cms/pages/new" element={<PageEditor />} />
        <Route path="/cms/pages/:id" element={<PageEditor />} />
        <Route path="/cms/blocks" element={<BlocksListPage />} />
        <Route path="/cms/blocks/new" element={<BlockEditor />} />
        <Route path="/cms/blocks/:id" element={<BlockEditor />} />
        <Route path="/cms/templates" element={<TemplatesListPage />} />
        <Route path="/cms/templates/new" element={<TemplateEditor />} />
        <Route path="/cms/templates/:id" element={<TemplateEditor />} />
        <Route path="/cms/hooks" element={<HooksPage />} />
        <Route path="/megamenu" element={<MegamenuListPage />} />
        <Route path="/megamenu/:id" element={<MegamenuEditor />} />
        <Route path="/blog/posts" element={<BlogPostListPage />} />
        <Route path="/blog/posts/new" element={<BlogPostEditor />} />
        <Route path="/blog/posts/:id" element={<BlogPostEditor />} />
        <Route path="/blog/categories" element={<BlogCategoryTreePage />} />
        <Route path="/blog/categories/new" element={<BlogCategoryEditor />} />
        <Route path="/blog/categories/:id" element={<BlogCategoryEditor />} />
        <Route path="/blog/tags" element={<BlogTagListPage />} />
        <Route path="/platform/modules" element={<PlatformModulesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/groups" element={<SettingsGroupsPage />} />
        <Route path="/settings/cache" element={<CachePage />} />
        <Route path="/settings/pwa" element={<PwaPage />} />
        <Route path="/sales-channels" element={<SalesChannelsListPage />} />
        <Route path="/sales-channels/new" element={<SalesChannelEditPage />} />
        <Route path="/sales-channels/:code" element={<SalesChannelEditPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        {/* Every module-owned screen, from the generated registry. `App.tsx`
            declares the host's own routes and nothing else; a module adds one
            by shipping `src/admin/` and regenerating (feature 091, FR-010). */}
        {registryRoutes().map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              <ModuleRoute
                module={route.module}
                requiredPermission={route.requiredPermission}
                load={route.component}
              />
            }
          />
        ))}
        <Route
          path="*"
          element={<NotFoundPage />}
        />
          </Route>
        </Routes>
        </AdminActionsProvider>
        </ModulePresenceProvider>
      </AppLanguageContext.Provider>
    </TranslationProvider>
  );
}
