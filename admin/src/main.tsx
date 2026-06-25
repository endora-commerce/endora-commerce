import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { AuthProvider } from './lib/auth.js';
import { registerAdminServiceWorker } from './registerSw.js';
import './index.css';
import './styles/design-tokens.css';
import './styles/components.css';

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
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
