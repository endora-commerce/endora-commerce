import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App, AuthProvider, registerAdminServiceWorker } from '@endora-commerce/admin-shell';
import { MODULE_ADMIN_CONTRIBUTIONS } from './modules.generated.js';
import './index.css';
import './styles/design-tokens.css';
import './styles/components.css';

/**
 * The admin project's entry point, and the whole of what an instance holds
 * (feature 110, T120; `contracts/instance-repository.md` R2.1).
 *
 * The tree, the router and every screen are `@endora-commerce/admin-shell`'s.
 * What is the project's own is on the four lines above and the one below: the
 * theme tokens, and `MODULE_ADMIN_CONTRIBUTIONS` — the generated registry of
 * the module packages this deployment installed, which the shell takes as a
 * prop because Vite is a static build and a package cannot name a file in the
 * project that consumes it (R3.2).
 */
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('root element not found; check index.html');
}

// Feature 046 (US6) — installable admin PWA. No push (FR-025).
registerAdminServiceWorker();

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App contributions={MODULE_ADMIN_CONTRIBUTIONS} />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
