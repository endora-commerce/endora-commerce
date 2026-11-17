import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';


/**
 * `specs/152-compare-pdf-template/` T039, T068 — `document_templates` owns its
 * admin surface, and the links into it follow it (Constitution XVII item 5,
 * FR-050, FR-063):
 *
 *  - the sidebar entry and both routes, present with the module and the read
 *    code, absent without either, restored without a rebuild;
 *  - the *PDF template* button on the comparisons list, shown only with the
 *    module present **and** `document_templates:read`.
 *
 * The palette entry is the server's (`AdminActionsService` over the effective
 * enabled-set) and is asserted in
 * `backend/test/contract/document_templates/off-state.test.ts`.
 */

let presentModules = new Set<string>(['document_templates']);
let permissions = new Set<string>(['document_templates:read']);



vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async () => ({ data: [], meta: { limit: 20, nextCursor: null } })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../packages/admin-shell/src/App');

const bundle = {
  ...passthroughBundle('core', ['appShell.brand.text', 'appShell.section.content', 'appShell.section.customers', 'app.moduleScreenLoading', 'app.notFound']),
  ...passthroughBundle('document_templates', ['nav.documentTemplates.label', 'page.title', 'page.empty']),
  ...passthroughBundle('comparisons', ['nav.comparisons.label', 'list.page.title', 'list.pdfTemplate']),
};

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App contributions={MODULE_ADMIN_CONTRIBUTIONS} modulePresence={modulePresence({ present: [...presentModules] })} translations={{}} />
      </MemoryRouter>,
      { session: adminSession({ permissions: [...permissions] }) },
    ),
    bundle,
  );
}

const sidebarHrefs = (): (string | null)[] =>
  [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;
const screenIsRendered = (key: string): boolean => screen.queryAllByText(new RegExp(key.replace(/\./g, '\\.'))).length > 0;

describe('document_templates owns its admin surface (spec 152)', () => {
  it('contributes its sidebar entry and screens while present, to a reader', async () => {
    presentModules = new Set(['document_templates']);
    permissions = new Set(['document_templates:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).toContain('/document-templates');
    expect(screen.getByRole('link', { name: /nav\.documentTemplates\.label/ })).toBeTruthy();
    shell.unmount();
    renderAt('/document-templates');
    await waitFor(() => expect(screenIsRendered('page.title')).toBe(true));
  });

  it('contributes nothing while switched off — the editor route included', async () => {
    presentModules = new Set();
    permissions = new Set(['document_templates:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/document-templates');
    shell.unmount();
    const list = renderAt('/document-templates');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    list.unmount();
    renderAt('/document-templates/11111111-1111-4111-8111-111111111111');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
  });

  it('contributes nothing to an administrator without document_templates:read', async () => {
    presentModules = new Set(['document_templates']);
    permissions = new Set(['comparisons:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/document-templates');
    shell.unmount();
    renderAt('/document-templates');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
  });

  it('restores the entry when the module comes back', () => {
    presentModules = new Set();
    permissions = new Set(['document_templates:read']);
    renderAt('/').unmount();
    presentModules = new Set(['document_templates']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/document-templates');
  });
});

describe('the comparisons list links to the comparison PDF template (FR-063)', () => {
  const button = (): HTMLElement | null => screen.queryByRole('link', { name: /list\.pdfTemplate/ });

  it('shows the link with the module present and the read code', async () => {
    presentModules = new Set(['comparisons', 'document_templates']);
    permissions = new Set(['comparisons:read', 'document_templates:read']);
    renderAt('/comparisons');
    await waitFor(() => expect(screenIsRendered('list.page.title')).toBe(true));
    expect(button()?.getAttribute('href')).toBe('/document-templates?type=comparisons.comparison');
  });

  it('hides it while document templates are off, and without the read code', async () => {
    presentModules = new Set(['comparisons']);
    permissions = new Set(['comparisons:read', 'document_templates:read']);
    const off = renderAt('/comparisons');
    await waitFor(() => expect(screenIsRendered('list.page.title')).toBe(true));
    expect(button()).toBeNull();
    off.unmount();
    presentModules = new Set(['comparisons', 'document_templates']);
    permissions = new Set(['comparisons:read']);
    renderAt('/comparisons');
    await waitFor(() => expect(screenIsRendered('list.page.title')).toBe(true));
    expect(button()).toBeNull();
  });
});
