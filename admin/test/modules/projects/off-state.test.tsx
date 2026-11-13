import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../../setup';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../../src/modules.generated.js';

/**
 * The `projects` admin surface switched off, and on again
 * (`specs/163-projects-and-tasks/`, User Story 1 — tasks T055 and T057;
 * Principle XVII item 5, `contracts/admin-surfaces.md` §7).
 *
 * The backend half — every route answering 503 while the module is off — is
 * `backend/test/integration/projects/off-state.test.ts`. This file owns the
 * other half: no sidebar entry and no screen while the module is absent, or for
 * an operator without the code each route enforces, and both back when the
 * module and the code are.
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

const entry = MODULE_ADMIN_CONTRIBUTIONS.find((candidate) => candidate.moduleId === 'projects');
const routes = entry?.contributions.routes ?? [];

const bundle = {
  ...passthroughBundle('core', ['appShell.brand.text', 'appShell.section.work', 'app.moduleScreenLoading', 'app.notFound']),
  ...passthroughBundle(
    'projects',
    (entry?.contributions.nav ?? []).map((item) => item.labelKey),
  ),
};

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

const READ_AND_WRITE = ['projects:read', 'projects:write', 'projects:configure', 'projects:analytics'];

describe('projects admin surface', () => {
  it('is registered: the list, the create screen, the Templates screens, Roles, loss reasons, analytics and one Project', () => {
    expect(routes.map((route) => route.path)).toEqual([
      '/projects',
      '/projects/new',
      '/projects/templates',
      '/projects/templates/new',
      '/projects/templates/:id',
      '/projects/roles',
      '/projects/loss-reasons',
      '/projects/analytics',
      '/projects/:id',
    ]);
  });

  it('contributes its sidebar entry and every screen while present', async () => {
    presentModules = new Set(['projects']);
    permissions = new Set(READ_AND_WRITE);
    const shell = renderAt('/');
    expect(sidebarHrefs()).toContain('/projects');
    expect(sidebarHrefs()).toContain('/projects/templates');
    expect(sidebarHrefs()).toContain('/projects/roles');
    expect(sidebarHrefs()).toContain('/projects/loss-reasons');
    expect(sidebarHrefs()).toContain('/projects/analytics');
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
    expect(sidebarHrefs()).not.toContain('/projects');
    expect(sidebarHrefs()).not.toContain('/projects/templates');
    expect(sidebarHrefs()).not.toContain('/projects/roles');
    expect(sidebarHrefs()).not.toContain('/projects/loss-reasons');
    expect(sidebarHrefs()).not.toContain('/projects/analytics');
    shell.unmount();
    for (const route of routes) {
      const deepLink = renderAt(concreteUrl(route.path));
      await waitFor(() => expect(notFoundIsRendered(), route.path).toBe(true));
      deepLink.unmount();
    }
  });

  it('withholds the create screen from a reader, Templates from somebody without projects:configure, analytics from somebody without projects:analytics, and everything from somebody without projects:read', async () => {
    presentModules = new Set(['projects']);
    permissions = new Set(['projects:read']);
    const reader = renderAt('/projects/new');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    reader.unmount();

    // Templates are configuration: projects:write is not enough.
    permissions = new Set(['projects:read', 'projects:write']);
    const writer = renderAt('/');
    expect(sidebarHrefs()).toContain('/projects');
    expect(sidebarHrefs()).not.toContain('/projects/templates');
    expect(sidebarHrefs()).not.toContain('/projects/roles');
    expect(sidebarHrefs()).not.toContain('/projects/loss-reasons');
    expect(sidebarHrefs()).not.toContain('/projects/analytics');
    writer.unmount();
    for (const path of [
      '/projects/templates',
      '/projects/templates/new',
      concreteUrl('/projects/templates/:id'),
      '/projects/roles',
      '/projects/loss-reasons',
      '/projects/analytics',
    ]) {
      const screen = renderAt(path);
      await waitFor(() => expect(notFoundIsRendered(), path).toBe(true));
      screen.unmount();
    }

    permissions = new Set(['projects:write']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/projects');
    shell.unmount();
    const list = renderAt('/projects');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    list.unmount();
  });

  it('restores every surface when the module is switched on again', async () => {
    presentModules = new Set(['projects']);
    permissions = new Set(READ_AND_WRITE);
    const shell = renderAt('/');
    expect(sidebarHrefs()).toContain('/projects');
    shell.unmount();
    const list = renderAt('/projects');
    await waitFor(() => expect(notFoundIsRendered()).toBe(false));
    list.unmount();
  });
});
