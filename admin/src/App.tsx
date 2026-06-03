import { useEffect, useState, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { LoginPage } from './components/LoginPage.js';
import { useAuth } from './lib/auth.js';
import { TranslationProvider } from './i18n/TranslationProvider.js';
import { useTranslation } from './i18n/useTranslation.js';
import { appBootstrapCopy } from './i18n/preauth-login-copy.js';
import { AdminActionsProvider } from './lib/admin-actions/AdminActionsProvider.js';
import { AppLanguageContext } from './i18n/app-language-context.js';
import type { SupportedAdminLanguage } from './i18n/types.js';
import { ApiKeysPage } from './modules/api_keys/ApiKeysPage.js';
import { WebhooksPage } from './modules/webhooks/WebhooksPage.js';
import { IntegrationsPage } from './modules/integrations/IntegrationsPage.js';
import { AnalyticsPage } from './modules/analytics/AnalyticsPage.js';
import { ImportExportPage } from './modules/import_export/ImportExportPage.js';
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
import { RfqDetail } from './modules/quote_requests/RfqDetail.js';
import { AdminUsersPage } from './modules/admin_users/AdminUsersPage.js';
import { AdminRolesPage } from './modules/admin_users/AdminRolesPage.js';
import { AuditLogViewer } from './modules/audit_logs/AuditLogViewer.js';
import { ProductsList } from './modules/catalog/ProductsList.js';
import { ProductEditor } from './modules/catalog/ProductEditor.js';
import { CategoriesTree } from './modules/catalog/CategoriesTree.js';
import { AttributesManager } from './modules/catalog/AttributesManager.js';
import { AttributeSetsPage } from './modules/catalog/AttributeSetsPage.js';
import { AttachmentTypesPage } from './modules/catalog/AttachmentTypesPage.js';
import { BulkOperationsPage } from './modules/catalog/BulkOperationsPage.js';
import { LibraryPage as AssetsLibraryPage } from './modules/assets_library/pages/LibraryPage.js';
import { OrganizationsList } from './modules/organizations/OrganizationsList.js';
import { OrganizationDetail } from './modules/organizations/OrganizationDetail.js';
import { CustomersList } from './modules/customers/CustomersList.js';
import { CustomerDetail } from './modules/customers/CustomerDetail.js';
import { OnlineCustomers } from './modules/customers/OnlineCustomers.js';
import { OrdersList } from './modules/orders/OrdersList.js';
import { OrderDetail } from './modules/orders/OrderDetail.js';
import { OrderStatusConfigPage } from './modules/orders/OrderStatusConfigPage.js';
import { OrderCreatePage } from './modules/orders/OrderCreatePage.js';
import { QuickOrderOnBehalfPage } from './modules/quick_order/QuickOrderOnBehalfPage.js';
import { CartsList } from './modules/carts/CartsList.js';
import { CartDetail } from './modules/carts/CartDetail.js';
import { InvoicesList } from './modules/invoices/InvoicesList.js';
import { TaxesPage } from './modules/taxes/TaxesPage.js';
import { PromotionsPage } from './modules/promotions/PromotionsPage.js';
import { PriceListsPage } from './modules/price_lists/PriceListsPage.js';
import { PriceListDetailPage } from './modules/price_lists/PriceListDetailPage.js';
import { DisplayModeOverridesPage } from './modules/price_lists/DisplayModeOverridesPage.js';
import { HomePage } from './modules/home/HomePage.js';
import { DeliveryMethodsPage } from './modules/delivery_methods/DeliveryMethodsPage.js';
import { PaymentMethodsPage } from './modules/payment_methods/PaymentMethodsPage.js';
import { InventoryPage } from './modules/inventory/InventoryPage.js';
import { LowStockPage } from './modules/inventory/LowStockPage.js';
import { AvailabilityNotificationsPage } from './modules/inventory/AvailabilityNotificationsPage.js';
import { StockImportWizard } from './modules/inventory/StockImportWizard.js';
import { WarehousesList } from './modules/warehouses/WarehousesList.js';
import { WarehouseEditor } from './modules/warehouses/WarehouseEditor.js';
import { CreditLimitsPage } from './modules/credit_limits/CreditLimitsPage.js';
import { SettingsPage } from './modules/settings/pages/SettingsPage.js';
import { GroupsPage as SettingsGroupsPage } from './modules/settings/pages/GroupsPage.js';
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
        <AdminActionsProvider language={language}>
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
        <Route path="/assets-library" element={<AssetsLibraryPage />} />
        <Route path="/organizations" element={<OrganizationsList />} />
        <Route path="/organizations/:id" element={<OrganizationDetail />} />
        <Route path="/customers" element={<CustomersList />} />
        <Route path="/customers/online" element={<OnlineCustomers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/orders" element={<OrdersList />} />
        <Route path="/orders/new" element={<OrderCreatePage />} />
        <Route path="/orders/quick-order" element={<QuickOrderOnBehalfPage />} />
        <Route path="/orders/statuses" element={<OrderStatusConfigPage />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/carts" element={<CartsList />} />
        <Route path="/carts/:id" element={<CartDetail />} />
        <Route path="/invoices" element={<InvoicesList />} />
        <Route path="/taxes" element={<TaxesPage />} />
        <Route path="/promotions" element={<PromotionsPage />} />
        <Route path="/price-lists" element={<PriceListsPage />} />
        <Route path="/price-lists/display-modes" element={<DisplayModeOverridesPage />} />
        <Route path="/price-lists/:id" element={<PriceListDetailPage />} />
        <Route path="/delivery-methods" element={<DeliveryMethodsPage />} />
        <Route path="/payment-methods" element={<PaymentMethodsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/low-stock" element={<LowStockPage />} />
        <Route path="/inventory/notifications" element={<AvailabilityNotificationsPage />} />
        <Route path="/inventory/import" element={<StockImportWizard />} />
        <Route path="/warehouses" element={<WarehousesList />} />
        <Route path="/warehouses/new" element={<WarehouseEditor />} />
        <Route path="/warehouses/:id" element={<WarehouseEditor />} />
        <Route path="/credit-limits" element={<CreditLimitsPage />} />
        <Route path="/quote-requests" element={<RfqList />} />
        <Route path="/quote-requests/:id" element={<RfqDetail />} />
        <Route path="/comparisons" element={<ComparisonsListPage />} />
        <Route path="/comparisons/:id" element={<ComparisonDetailPage />} />
        <Route path="/admin-users" element={<AdminUsersPage />} />
        <Route path="/admin-roles" element={<AdminRolesPage />} />
        <Route path="/audit-log" element={<AuditLogViewer />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/import-export" element={<ImportExportPage />} />
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
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/groups" element={<SettingsGroupsPage />} />
        <Route path="/sales-channels" element={<SalesChannelsListPage />} />
        <Route path="/sales-channels/new" element={<SalesChannelEditPage />} />
        <Route path="/sales-channels/:code" element={<SalesChannelEditPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="*"
          element={<NotFoundPage />}
        />
          </Route>
        </Routes>
        </AdminActionsProvider>
      </AppLanguageContext.Provider>
    </TranslationProvider>
  );
}
