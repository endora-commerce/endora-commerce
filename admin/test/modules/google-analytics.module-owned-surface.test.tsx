import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

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
 * `google_analytics` is the **first batch of the drain** (feature 091, Phase 4)
 * and this is the off-state proof `contracts/admin-contribution.md` R15 asks of
 * a converted module.
 *
 * It differs from `import-export.module-owned-surface.test.tsx` in the two ways
 * the batch itself does, and both are the reason this module was picked:
 *
 *  * it contributes **three** routes, not one, so the parametric and the `/new`
 *    declaration are exercised beside the landing one — a module with a list
 *    and an editor is the ordinary shape and `import_export` is not;
 *  * it declares **palette actions** in its manifest, so all three surfaces
 *    Principle XVII item 5 names are answerable here. The route and the sidebar
 *    entry are withdrawn by `isSurfaceVisible` at render, which this file
 *    measures; the palette's Actions group is resolved by the server from the
 *    effective enabled-set, so its off-state proof is
 *    `backend/test/integration/google_analytics/off-state.test.ts` and this
 *    file asserts only the half that is the admin's — that the shell names
 *    neither of the module's routes in its own `PALETTE_ITEMS`, so there is no
 *    client-side copy for the server's answer to disagree with.
 *
 * The permission axis is asserted beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing.
 */

let presentModules = new Set<string>(['google_analytics']);
let permissions = new Set<string>(['google_analytics:read', 'google_analytics:write']);



vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
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

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

/**
 * The label key resolves in the **module's** namespace, not in `core`. That is
 * the half of the conversion the shared `_i18n` bundle used to own: its
 * `appShell.nav.googleAnalytics` entry is gone, and this scope is where the
 * replacement lives.
 */
const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.analyticsAds',
    'appShell.section.system',
    'appShell.nav.users',
  ]),
  ...passthroughBundle('google_analytics', ['nav.googleAnalytics.label']),
};

function renderShell(): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: [...permissions] }), presence: modulePresence({ present: [...presentModules] }) },
    ),
    bundle,
  );
}

function sidebarHrefs(): (string | null)[] {
  return [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
}

describe('google_analytics owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    presentModules = new Set(['google_analytics']);
    permissions = new Set(['google_analytics:read']);
    renderShell();
    expect(sidebarHrefs()).toContain('/google-analytics');
    expect(screen.getByRole('link', { name: /nav\.googleAnalytics\.label/ })).toBeTruthy();
  });

  it('contributes nothing while the module is switched off', () => {
    // Principle XVII item 5. The registry still names the module — it answers
    // "what could be here" — and the render is what withdraws it, so the
    // operator's flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set(['google_analytics:read']);
    renderShell();
    expect(sidebarHrefs()).not.toContain('/google-analytics');
  });

  it('contributes nothing to an operator without the code its landing route enforces', () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `:write` alone is
    // not enough — the codes are opaque strings and the sidebar gates on the
    // read code the list route actually enforces.
    presentModules = new Set(['google_analytics']);
    permissions = new Set(['google_analytics:write']);
    renderShell();
    expect(sidebarHrefs()).not.toContain('/google-analytics');
  });

  it('restores the entry when the module comes back, with no rebuild', () => {
    presentModules = new Set();
    permissions = new Set(['google_analytics:read']);
    const off = renderShell();
    expect(sidebarHrefs()).not.toContain('/google-analytics');
    off.unmount();

    presentModules = new Set(['google_analytics']);
    renderShell();
    expect(sidebarHrefs()).toContain('/google-analytics');
  });
});

describe('the shell no longer names this module by hand', () => {
  it('has no `/google-analytics` entry in the host NAV or the host route table', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither mentions this module now, and the screens are still
    // there. The breadcrumb table is the third and is derived rather than
    // enumerated — `registryCrumbs` builds the trail for `/google-analytics`
    // and everything under it from the composed sidebar.
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(app).not.toContain('google_analytics');
    expect(app).not.toContain('CustomEventsListPage');
    expect(app).not.toContain('CustomEventEditPage');
    expect(shell).not.toContain("to: '/google-analytics'");
    expect(shell).not.toContain('appShell.nav.googleAnalytics');
  });

  it('keeps no client-side copy of the module’s palette entries', () => {
    // The palette's Actions group is the server's — it resolves the manifest's
    // `actions` against the effective enabled-set, which is where the module's
    // two entries live and where their off-state is proven. What the admin must
    // not do is carry a second, hand-written copy in `PALETTE_ITEMS`: that one
    // would keep advertising the screen after an operator switched the module
    // off, because nothing on the server would have been asked.
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(shell).not.toContain("'/google-analytics'");
  });

  it('resolves the screens through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-google-analytics/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('loads all three screens lazily, and the editor behind one factory', async () => {
    // FR-013. The property is a consequence of the declaration shape: the only
    // function-valued field is a dynamic-import factory, so Vite has a split
    // point whether or not anybody remembers to ask for one. The `/new` and
    // `/:id` declarations share **one** factory value, so the editor is one
    // chunk and not two.
    const { contributions } = await import('@endora-commerce/mod-google-analytics/admin');
    const routes = contributions.routes ?? [];
    expect(routes.map((route) => route.path)).toEqual([
      '/google-analytics',
      '/google-analytics/new',
      '/google-analytics/:id',
    ]);
    for (const route of routes) expect(typeof route.component).toBe('function');
    expect(routes[1]!.component).toBe(routes[2]!.component);
    // Awaited directly, with no `waitFor` around it. A dynamic import is not a
    // DOM observation: `waitFor` would put a 1000 ms deadline on vite-node
    // transforming this screen's module graph, and — because its retry loop
    // skips every tick while its callback's promise is still pending — grant
    // exactly one attempt inside that deadline. That is a guillotine, not a
    // retry.
    for (const route of routes) {
      const loaded = await route.component();
      expect(typeof loaded.default).toBe('function');
    }
  });

  it('gates the editor on the write code and the list on the read code', async () => {
    // `check:action-route-permissions` holds this module's two palette actions
    // to the code enforced on their own `targetRoute`; the route declarations
    // are the same statement one layer down, and nothing else compares them.
    const { contributions } = await import('@endora-commerce/mod-google-analytics/admin');
    const byPath = new Map(
      (contributions.routes ?? []).map((route) => [route.path, route.requiredPermission]),
    );
    expect(byPath.get('/google-analytics')).toBe('google_analytics:read');
    expect(byPath.get('/google-analytics/new')).toBe('google_analytics:write');
    expect(byPath.get('/google-analytics/:id')).toBe('google_analytics:write');
    expect(contributions.nav?.[0]?.requiredPermission).toBe('google_analytics:read');
  });
});
