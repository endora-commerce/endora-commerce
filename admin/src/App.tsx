import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { ApiKeysPage } from './modules/api_keys/ApiKeysPage.js';
import { WebhooksPage } from './modules/webhooks/WebhooksPage.js';
import { IntegrationsPage } from './modules/integrations/IntegrationsPage.js';
import { AnalyticsPage } from './modules/analytics/AnalyticsPage.js';
import { ImportExportPage } from './modules/import_export/ImportExportPage.js';

export function App(): ReactNode {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/api-keys" replace />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/import-export" element={<ImportExportPage />} />
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
