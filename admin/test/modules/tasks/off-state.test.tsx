import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminZoneName } from '@endora-commerce/contracts';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../../setup';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../../src/modules.generated.js';

/**
 * The `tasks` admin surface switched off, and on again
 * (`specs/163-projects-and-tasks/`, User Story 2 — tasks T067 and T072;
 * Principle XVII item 5, `contracts/admin-surfaces.md` §7).
 *
 * The backend half — every route answering 503 while the module is off — is
 * `backend/test/integration/tasks/off-state.test.ts`. This file owns the other
 * half: no sidebar entry and no screen while the module is absent, or for an
 * operator without the code each route enforces, and both back when the module
 * and the code are — and the *Tasks* panel the module contributes to an Order's,
 * a Quote Request's and an Opportunity's screen (`specs/165-task-management/`
 * User Story 6, T065), which follows the module's presence the same way. The
 * Projects side of the same absence — no *Tasks* tab and
 * no Stage Task editor — is `projects/ProjectDetail.tasks-tab.test.tsx`.
 *
 * Each absence comes after a presence seen in the same file — an absence proves
 * nothing until the presence has been seen.
 */

let presentModules = new Set<string>();
let permissions = new Set<string>();

vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../../packages/admin-shell/src/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('../../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

/** Every screen fetches on mount; a pending answer leaves each in its own loading state. */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  const pending = (): Promise<never> => new Promise<never>(() => {});
  return {
    ...actual,
    apiClient: {
      get: vi.fn(pending),
      post: vi.fn(pending),
      put: vi.fn(pending),
      patch: vi.fn(pending),
      delete: vi.fn(pending),
    },
  };
});

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../../packages/admin-shell/src/App');

const entry = MODULE_ADMIN_CONTRIBUTIONS.find((candidate) => candidate.moduleId === 'tasks');
const routes = entry?.contributions.routes ?? [];

const bundle = {
  ...passthroughBundle('core', ['appShell.brand.text', 'appShell.section.work', 'app.moduleScreenLoading', 'app.notFound']),
  ...passthroughBundle('tasks', [...(entry?.contributions.nav ?? []).map((item) => item.labelKey), 'panel.title']),
};

const RECORD_ID = '00000000-0000-4000-8000-0000000000c7';

/** The three record screens' zones and what each hands its contributors. */
const RECORD_ZONES = [
  { zone: 'order.detail.after', props: { orderId: RECORD_ID } },
  { zone: 'quote_request.detail.after', props: { quoteRequestId: RECORD_ID } },
  { zone: 'opportunity.detail.after', props: { opportunityId: RECORD_ID } },
] as const;

/** One record screen's zone alone, filled from every module's contributions. */
function renderZone(record: (typeof RECORD_ZONES)[number]): RenderResult {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter>
          <AdminZone name={record.zone as AdminZoneName} props={record.props as never} />
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: [...permissions] }),
        presence: modulePresence({ present: [...presentModules] }),
        contributions: MODULE_ADMIN_CONTRIBUTIONS,
      },
    ),
    bundle,
  );
}

const tasksPanelShown = async (): Promise<boolean> =>
  (await screen.findAllByRole('heading', { name: 'panel.title' }).catch(() => [])).length > 0;

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App contributions={MODULE_ADMIN_CONTRIBUTIONS} modulePresence={modulePresence({ present: [...presentModules] })} />
      </MemoryRouter>,
      { session: adminSession({ permissions: [...permissions] }) },
    ),
    bundle,
  );
}

const sidebarHrefs = (): (string | null)[] =>
  [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));

const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

const concreteUrl = (pattern: string): string => pattern.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-0000000000f1');

const READ_AND_WRITE = ['tasks:read', 'tasks:write'];

describe('tasks admin surface', () => {
  it('is registered: the list, My Tasks, the create screen, the four settings screens (165) and one Task', () => {
    expect(routes.map((route) => route.path)).toEqual([
      '/tasks',
      '/tasks/mine',
      '/tasks/new',
      '/tasks/settings/workflow',
      '/tasks/settings/priorities',
      '/tasks/settings/tags',
      '/tasks/settings/general',
      '/tasks/:id',
    ]);
  });

  it('contributes its sidebar entries and every screen while present', async () => {
    presentModules = new Set(['tasks']);
    permissions = new Set([...READ_AND_WRITE, 'tasks:configure']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).toEqual(expect.arrayContaining(['/tasks/mine', '/tasks', '/tasks/settings/workflow']));
    shell.unmount();
    for (const route of routes) {
      const rendered = renderAt(concreteUrl(route.path));
      await waitFor(() => expect(notFoundIsRendered(), route.path).toBe(false));
      rendered.unmount();
    }
  });

  it('contributes no surface while the module is switched off', async () => {
    presentModules = new Set();
    permissions = new Set(READ_AND_WRITE);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/tasks');
    expect(sidebarHrefs()).not.toContain('/tasks/mine');
    expect(sidebarHrefs()).not.toContain('/tasks/settings/workflow');
    shell.unmount();
    for (const route of routes) {
      const deepLink = renderAt(concreteUrl(route.path));
      await waitFor(() => expect(notFoundIsRendered(), route.path).toBe(true));
      deepLink.unmount();
    }
  });

  it('withholds the create screen from a reader, the settings screens from a writer, and everything from somebody without tasks:read', async () => {
    presentModules = new Set(['tasks']);
    permissions = new Set(['tasks:read']);
    const reader = renderAt('/tasks/new');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    reader.unmount();

    permissions = new Set(READ_AND_WRITE);
    const writerShell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/tasks/settings/workflow');
    writerShell.unmount();
    const writer = renderAt('/tasks/settings/workflow');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    writer.unmount();
    for (const path of ['/tasks/settings/priorities', '/tasks/settings/tags', '/tasks/settings/general']) {
      const settings = renderAt(path);
      await waitFor(() => expect(notFoundIsRendered(), path).toBe(true));
      settings.unmount();
    }

    permissions = new Set(['tasks:write']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/tasks');
    expect(sidebarHrefs()).not.toContain('/tasks/mine');
    shell.unmount();
    for (const path of ['/tasks', '/tasks/mine']) {
      const list = renderAt(path);
      await waitFor(() => expect(notFoundIsRendered(), path).toBe(true));
      list.unmount();
    }
  });

  it('puts the Tasks panel on an Order, a Quote Request and an Opportunity only while present (US6, T065)', async () => {
    permissions = new Set(READ_AND_WRITE);
    for (const record of RECORD_ZONES) {
      presentModules = new Set(['tasks']);
      const on = renderZone(record);
      expect(await tasksPanelShown(), record.zone).toBe(true);
      on.unmount();

      presentModules = new Set();
      const off = renderZone(record);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole('heading', { name: 'panel.title' }), record.zone).toBeNull();
      off.unmount();

      presentModules = new Set(['tasks']);
      const back = renderZone(record);
      expect(await tasksPanelShown(), record.zone).toBe(true);
      back.unmount();
    }
  });

  it('restores every surface when the module is switched on again', async () => {
    presentModules = new Set(['tasks']);
    permissions = new Set(READ_AND_WRITE);
    const shell = renderAt('/');
    expect(sidebarHrefs()).toEqual(expect.arrayContaining(['/tasks/mine', '/tasks']));
    shell.unmount();
    const list = renderAt('/tasks');
    await waitFor(() => expect(notFoundIsRendered()).toBe(false));
    list.unmount();
  });
});
