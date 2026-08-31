import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';

/**
 * One of the admin's own source files, read as text.
 *
 * From the workspace root vitest hands this file, because `import.meta.url` is
 * an `http:` URL under jsdom and `node:fs` cannot read one.
 */
function sourceOf(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * `pwa` is the **route-less** member of feature 091's Phase 4, and this file is
 * the other half of the pair `mfa` and `carts` opened.
 *
 * Those two proved that a module contributing no *sidebar entry* still has a
 * real off-state proof, written over the route. This one is the mirror: a
 * module contributing no *route*. `AdminContributions` says in as many words
 * that *"a module shipping only a nav entry pointing at a host route is legal"*
 * and nothing in the tree exercised it, so the shape was supported by a
 * sentence and by no test.
 *
 * **The destination stays a host route, and the consequence is stated rather
 * than asserted away.** `/settings/pwa` renders `PwaPage`, which lives under
 * `admin/src/modules/settings/pages/` — `settings`' directory — so
 * `check:admin-registrations` attributes the route to `settings` and this
 * module's baseline row has always read `{ routes: 0, nav: 1 }`. A host
 * `<Route>` is ungated, so an operator following the URL with `pwa` switched
 * off still reaches the screen and meets the module's own 503 field by field.
 * That is unchanged by this batch and is not something it could change: the
 * route moves when `settings`' directory moves, which is that module's batch.
 * What this batch withdraws is the **advertisement**, which is what an operator
 * navigates by.
 *
 * So the four cases are driven over the sidebar entry, which is the whole of
 * what this module contributes, and the fifth assertion below records the
 * split: the entry's destination is a route the admin declares somewhere, so a
 * later batch cannot move the screen and leave this entry pointing at nothing.
 *
 * The palette half of Principle XVII item 5 is the server's — this module
 * declares no manifest action, and `backend/test/unit/pwa/manifest-and-permissions.test.ts`
 * is where its manifest is asserted.
 */

let presentModules = new Set<string>(['pwa']);
let permissions = new Set<string>();

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    status: 'authenticated',
    me: {
      adminUser: {
        id: '1',
        email: 'admin@test.com',
        firstName: 'Ada',
        lastName: 'Min',
        preferredLanguage: 'en',
      },
      role: { name: 'Admin' },
    },
    logout: vi.fn(),
    hasPermission: (code: string) => permissions.has(code),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [],
    isPresent: (moduleId: string) => presentModules.has(moduleId),
    presenceOf: () => undefined,
    isLoading: false,
    error: null,
    refresh: async () => {},
  }),
  ModulePresenceProvider: ({ children }: { children: React.ReactNode }) => children,
  setModuleActivation: vi.fn(),
  getModulePresence: vi.fn(),
}));

vi.mock('@/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('@/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('@/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('@/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

/**
 * `App.tsx` imports every host screen statically, and one of them
 * (`cms`' Puck editor) reaches `@dnd-kit/dom`, which constructs a
 * `ResizeObserver` at module scope. jsdom has none. The stub is a
 * module-load accommodation and nothing this file asserts touches it.
 */
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../src/App');

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.system',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...passthroughBundle('pwa', ['nav.pwa.label']),
};

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
    bundle,
  );
}

function sidebarHrefs(): (string | null)[] {
  return [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
}

describe('pwa owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first.
    presentModules = new Set(['pwa']);
    permissions = new Set(['pwa:read']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/settings/pwa');
    // The label resolves in the **module's** namespace, not in `core`: its
    // `appShell.nav.pwa` entry is gone from the shared `_i18n` bundle, and
    // `nav.pwa.label` in this package is where it lives now.
    expect(screen.getByRole('link', { name: /nav\.pwa\.label/ })).toBeTruthy();
  });

  it('contributes nothing while the module is switched off', () => {
    // Principle XVII item 5, over the one surface the module contributes. The
    // registry still names it — it answers "what could be here" — and the
    // render is what withdraws it, so a flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set(['pwa:read']);
    renderAt('/');
    expect(sidebarHrefs()).not.toContain('/settings/pwa');
  });

  it('contributes nothing to an operator without the code its destination enforces', () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `pwa:write` is a
    // real near-miss — this module's own configuration endpoints enforce it —
    // and it is not the code that opens the screen. The codes are opaque
    // strings, so holding the write code grants nothing about the read one.
    presentModules = new Set(['pwa']);
    permissions = new Set(['pwa:write']);
    renderAt('/');
    expect(sidebarHrefs()).not.toContain('/settings/pwa');
  });

  it('renders after the section’s host entries, in the declared order — the visible change', () => {
    // The batch's one operator-visible consequence, asserted rather than left
    // to a reader of the plan. *System* still holds host-declared rows, and
    // `composeNav` appends the registry's after all of them whatever weight
    // they declare — so this entry, which was last in the hand-written table,
    // is now last after the four already-converted ones instead of before
    // them. The weight (1400, the table's position times a hundred) is what
    // keeps it last among the converted entries rather than first.
    presentModules = new Set(['pwa', 'settings', 'audit_logs', 'import_export']);
    permissions = new Set(['pwa:read', 'settings:read', 'audit_log:read', 'catalog:write']);
    renderAt('/');
    const hrefs = sidebarHrefs();
    expect(hrefs).toContain('/settings/pwa');
    // After every converted entry that declares a lower weight…
    expect(hrefs.indexOf('/audit-log')).toBeLessThan(hrefs.indexOf('/settings/pwa'));
    expect(hrefs.indexOf('/import-export')).toBeLessThan(hrefs.indexOf('/settings/pwa'));
    // …and after `/settings`, a host-declared row it used to follow directly.
    // That relationship is the one the move preserves by accident of the entry
    // having been last; the rows between them are what changed.
    expect(hrefs.indexOf('/settings')).toBeLessThan(hrefs.indexOf('/settings/pwa'));
  });

  it('restores the entry when the module comes back, with no rebuild', () => {
    presentModules = new Set();
    permissions = new Set(['pwa:read']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/settings/pwa');
    off.unmount();

    presentModules = new Set(['pwa']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/settings/pwa');
  });
});

describe('the shell no longer names pwa by hand', () => {
  it('has no host nav entry or shared label for the module', () => {
    // The evidence that the conversion converted something. `AppShell.tsx` is
    // one of the two registries 11 of the last 12 module additions edited; it
    // no longer declares this entry, and the sidebar still renders it.
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(shell).not.toContain("to: '/settings/pwa'");
    expect(shell).not.toContain('appShell.nav.pwa');
  });

  it('keeps no client-side copy of the module’s palette entry', () => {
    // The palette's Actions group is the server's — it resolves the manifest's
    // `actions` against the effective enabled-set. What the admin must not do
    // is carry a second, hand-written copy in `PALETTE_ITEMS`: that one would
    // keep advertising the screen after the module was switched off, because
    // nothing on the server would have been asked.
    expect(sourceOf('src/components/AppShell.tsx')).not.toContain("'/settings/pwa'");
  });

  it('resolves the declaration through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-pwa/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('declares one nav entry, no route, and the code its destination enforces', async () => {
    // The declaration itself, because this is the shape nothing had exercised.
    // `pwa:read` is what every `GET /api/v1/admin/pwa/*` endpoint that opens
    // the screen enforces — not `pwa:write` and not `pwa:send_push`, which the
    // screen's writes enforce and neither of which opens it.
    const { contributions } = await import('@endora-commerce/mod-pwa/admin');
    expect(contributions.routes).toBeUndefined();
    expect(contributions.zones).toBeUndefined();
    expect(contributions.nav?.map((entry) => entry.to)).toEqual(['/settings/pwa']);
    expect(contributions.nav?.[0]?.requiredPermission).toBe('pwa:read');
    expect(contributions.nav?.[0]?.section).toBe('system');
    expect(contributions.nav?.[0]?.labelKey).toBe('nav.pwa.label');
  });

  it('advertises a destination the admin actually declares', async () => {
    // The split's record, and the assertion a later batch has to look at. The
    // entry points at a **host** route that `settings`' directory still owns,
    // so nothing in the registry declares it and `DuplicateAdminRouteError`
    // cannot fire. When `settings` is drained the route becomes a registry
    // route and this assertion holds through the other branch — what it
    // refuses in both worlds is an advertisement pointing at nothing.
    const { contributions } = await import('@endora-commerce/mod-pwa/admin');
    const target = contributions.nav?.[0]?.to ?? '';
    const { registryRoutes } = await import('../../src/lib/module-registry');
    const declaredByRegistry = registryRoutes().some((route) => route.path === target);
    const declaredByHost = sourceOf('src/App.tsx').includes(`path="${target}"`);
    expect(declaredByRegistry || declaredByHost).toBe(true);
  });

  it('keeps the module’s nav label in both shipped languages', () => {
    // R8: the bundle is the module's own and flat, and a key present in one
    // language only renders its raw key in the other. The palette's own
    // shape test covers manifest actions; this module declares none, so the
    // nav entry's label is the whole of its i18n surface.
    for (const language of ['en', 'pl']) {
      const parsed: unknown = JSON.parse(
        sourceOf(`../packages/modules/pwa/i18n/${language}.json`),
      );
      expect((parsed as Record<string, string>)['nav.pwa.label']).toBe('PWA');
    }
  });
});
