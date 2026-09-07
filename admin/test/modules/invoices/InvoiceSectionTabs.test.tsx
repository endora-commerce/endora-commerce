import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../../setup';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { InvoiceSectionTabs } from '../../../../packages/modules/invoices/src/admin/components/InvoiceSectionTabs';


// Feature 073 — every admin surface resolves its own presence from the module
// projection. These cases are about layout and routing, not about presence, so
// the projection names the ids this component asks about and nothing else; the
// filtering itself is covered in AppShell.module-presence.test.tsx.
//
// It is a **seeded provider**, not a stubbed hook, since feature 091's P3:
// `useModulePresence` is `@endora-commerce/admin-kit`'s, where a `vi.mock` on
// `@/lib/module-presence` cannot reach it. `withSession` supplies it through
// the `initial` prop it has carried since feature 073.

vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

/**
 * Two scopes since feature 091's batch 12: the strip's own labels are `core`'s,
 * and the sidebar row this file also asserts over is `invoices`' own —
 * `nav.invoices.label`, resolved in the module's namespace out of
 * `packages/modules/invoices/i18n/`, because the row arrives through
 * `composeNav` from `modules.generated.ts` now rather than from `AppShell`'s
 * hand-written table. `appShell.nav.invoices` no longer exists in any bundle.
 */
const bundle = {
  ...passthroughBundle('core', [
    'invoiceTabs.invoices',
    'invoiceTabs.templates',
    'appShell.brand.text',
    'appShell.section.sales',
    // The templates row left the sidebar long before this batch; the key is
    // named here because the case below asserts its **absence**.
    'appShell.nav.invoiceTemplates',
  ]),
  ...passthroughBundle('invoices', ['nav.invoices.label']),
};

/**
 * The one id the component asks about — it returns `null` when `invoices` is
 * absent, which is the whole of its presence behaviour.
 */
const PRESENT_MODULES = ['invoices'];

function renderTabs(path: string): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <InvoiceSectionTabs />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: PRESENT_MODULES }) },
    ),
    bundle,
  );
}

const selected = (name: string): string | null =>
  screen.getByRole('tab', { name }).getAttribute('aria-selected');

describe('InvoiceSectionTabs', () => {
  it('offers both routes', () => {
    renderTabs('/invoices');
    const hrefs = [...screen.getByRole('tablist').querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/invoices', '/invoices/templates']);
  });

  it('marks the invoices tab on the list route', () => {
    renderTabs('/invoices');
    expect(selected('invoiceTabs.invoices')).toBe('true');
    expect(selected('invoiceTabs.templates')).toBe('false');
  });

  it('marks the templates tab on the templates route', () => {
    // `/invoices` is a prefix of `/invoices/templates`; only the longest match
    // may light up, or both tabs would read as current at once.
    renderTabs('/invoices/templates');
    expect(selected('invoiceTabs.templates')).toBe('true');
    expect(selected('invoiceTabs.invoices')).toBe('false');
  });

  it('keeps the templates tab current inside the template editor', () => {
    renderTabs('/invoices/templates/abc-123');
    expect(selected('invoiceTabs.templates')).toBe('true');
  });

  it('treats an invoice detail route as the invoices tab', () => {
    renderTabs('/invoices/inv-42');
    expect(selected('invoiceTabs.invoices')).toBe('true');
    expect(selected('invoiceTabs.templates')).toBe('false');
  });
});

const { AppShell } = await import('../../../../packages/admin-shell/src/components/AppShell');

describe('AppShell — invoice templates leave the sidebar', () => {
  it('keeps Invoices and drops Invoice templates', () => {
    setMobileViewport(false);
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<div>Home</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: PRESENT_MODULES }) },
      ),
      bundle,
    );
    const hrefs = [...document.querySelectorAll('.b2b-sidebar a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/invoices');
    expect(hrefs).not.toContain('/invoices/templates');
  });
});
