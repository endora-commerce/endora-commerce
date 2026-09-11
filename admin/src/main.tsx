import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App, AuthProvider, registerAdminServiceWorker } from '@endora-commerce/admin-shell';
import { MODULE_ADMIN_CONTRIBUTIONS } from './modules.generated.js';
import './index.css';

/**
 * The admin project's entry point, and the whole of what an instance holds
 * (feature 110, T120; `contracts/instance-repository.md` R2.1).
 *
 * The tree, the router and every screen are `@endora-commerce/admin-shell`'s,
 * and the design system every one of them renders against is
 * `@endora-commerce/admin-kit`'s — this project imports both by name and holds
 * neither (T129, D-219). What is its own is on the two lines above and the one
 * below: the theme *overrides*, which are empty here, and
 * `MODULE_ADMIN_CONTRIBUTIONS` — the generated registry of
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
    {/*
      Module screens are `lazy()` inside `ModuleRoute`. RR 7's default
      `startTransition` update leaves `useLocation()` on the previous
      module while `history` already moved — URL changes, Outlet does not.
      Home works because it is eager. This flag makes location commit
      synchronously (react-router 7.14 `unstable_useTransitions`).
    */}
    <BrowserRouter unstable_useTransitions={false}>
      <AuthProvider>
        <App contributions={MODULE_ADMIN_CONTRIBUTIONS} />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
