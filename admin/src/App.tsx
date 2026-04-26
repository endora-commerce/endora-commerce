import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { ApiKeysPage } from './modules/api_keys/ApiKeysPage.js';
import { WebhooksPage } from './modules/webhooks/WebhooksPage.js';
import { IntegrationsPage } from './modules/integrations/IntegrationsPage.js';
import { AnalyticsPage } from './modules/analytics/AnalyticsPage.js';
import { ImportExportPage } from './modules/import_export/ImportExportPage.js';
import { SeoPage } from './modules/seo/SeoPage.js';
import { I18nPage } from './modules/i18n/I18nPage.js';
import { CmsPagesPage } from './modules/cms_pages/CmsPagesPage.js';
import { RfqList } from './modules/quote_requests/RfqList.js';
import { RfqDetail } from './modules/quote_requests/RfqDetail.js';
import { AdminUsersPage } from './modules/admin_users/AdminUsersPage.js';
import { AdminRolesPage } from './modules/admin_users/AdminRolesPage.js';
import { AuditLogViewer } from './modules/audit_logs/AuditLogViewer.js';
import { ProductsList } from './modules/catalog/ProductsList.js';
import { ProductEditor } from './modules/catalog/ProductEditor.js';
import { CategoriesTree } from './modules/catalog/CategoriesTree.js';
import { AttributesManager } from './modules/catalog/AttributesManager.js';
import { OrganizationsList } from './modules/organizations/OrganizationsList.js';
import { OrganizationDetail } from './modules/organizations/OrganizationDetail.js';
import { OrdersList } from './modules/orders/OrdersList.js';
import { OrderDetail } from './modules/orders/OrderDetail.js';
import { InvoicesList } from './modules/invoices/InvoicesList.js';
import { TaxesPage } from './modules/taxes/TaxesPage.js';
import { PromotionsPage } from './modules/promotions/PromotionsPage.js';
import { PriceListsPage } from './modules/price_lists/PriceListsPage.js';
import { DeliveryMethodsPage } from './modules/delivery_methods/DeliveryMethodsPage.js';
import { PaymentMethodsPage } from './modules/payment_methods/PaymentMethodsPage.js';
import { InventoryPage } from './modules/inventory/InventoryPage.js';

export function App(): ReactNode {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/catalog/products" replace />} />
        <Route path="/catalog/products" element={<ProductsList />} />
        <Route path="/catalog/products/:id" element={<ProductEditor />} />
        <Route path="/catalog/categories" element={<CategoriesTree />} />
        <Route path="/catalog/attributes" element={<AttributesManager />} />
        <Route path="/organizations" element={<OrganizationsList />} />
        <Route path="/organizations/:id" element={<OrganizationDetail />} />
        <Route path="/orders" element={<OrdersList />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/invoices" element={<InvoicesList />} />
        <Route path="/taxes" element={<TaxesPage />} />
        <Route path="/promotions" element={<PromotionsPage />} />
        <Route path="/price-lists" element={<PriceListsPage />} />
        <Route path="/delivery-methods" element={<DeliveryMethodsPage />} />
        <Route path="/payment-methods" element={<PaymentMethodsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/quote-requests" element={<RfqList />} />
        <Route path="/quote-requests/:id" element={<RfqDetail />} />
        <Route path="/admin-users" element={<AdminUsersPage />} />
        <Route path="/admin-roles" element={<AdminRolesPage />} />
        <Route path="/audit-log" element={<AuditLogViewer />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/import-export" element={<ImportExportPage />} />
        <Route path="/seo" element={<SeoPage />} />
        <Route path="/i18n" element={<I18nPage />} />
        <Route path="/cms" element={<CmsPagesPage />} />
        <Route
          path="*"
          element={
            <div className="alert alert--warning">
              Page not found. Pick a module from the sidebar.
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
