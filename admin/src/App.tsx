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

export function App(): ReactNode {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/quote-requests" replace />} />
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
