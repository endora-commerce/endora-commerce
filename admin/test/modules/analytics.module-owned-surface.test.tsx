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
 * `analytics` is the **second batch of the drain** (feature 091, Phase 4) and
 * this is the off-state proof `contracts/admin-contribution.md` R15 asks of a
 * converted module.
 *
 * Two things about it are this batch's and not batch one's:
 *
 *  * the module contributes **one** route, so what is exercised here is the
 *    single-screen shape rather than the list-plus-editor one — and the module
 *    was picked because it is the only remaining directory with zero incoming
 *    cross-module reach whose every host symbol the kit publishes, not because
 *    of its size;
 *  * its palette action is **new**. `analytics` has had an admin screen and a
 *    sidebar entry since feature 018 and has never been reachable under ⌘K,
 *    which Principle XVI says is not enough. The declaration lands in the merge
 *    request that makes the surface the module's, and its off-state — like
 *    `google_analytics`' — is proven server-side in
 *    `backend/test/integration/analytics/off-state.test.ts`, because the
 *    palette's Actions group is resolved from the manifest against the
 *    effective enabled-set and no admin-side test can see that. What this file
 *    asserts about the palette is only the half that is the admin's: that the
 *    shell keeps no hand-written copy of the module's route for the server's
 *    answer to disagree with.
 *
 * The permission axis is asserted beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing.
 */

let presentModules = new Set<string>(['analytics']);
let permissions = new Set<string>(['analytics:read']);



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
 * `appShell.nav.analytics` entry is gone, along with the fourteen `analytics.*`
 * keys the dashboard itself reads, and this scope is where both now live.
 */
const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.analyticsAds',
    'appShell.section.system',
    'appShell.nav.users',
  ]),
  ...passthroughBundle('analytics', ['nav.analytics.label']),
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

describe('analytics owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set(['analytics']);
    permissions = new Set(['analytics:read']);
    renderShell();
    expect(sidebarHrefs()).toContain('/analytics');
    expect(screen.getByRole('link', { name: /nav\.analytics\.label/ })).toBeTruthy();
  });

  it('contributes nothing while the module is switched off', () => {
    // Principle XVII item 5. The registry still names the module — it answers
    // "what could be here" — and the render is what withdraws it, so the
    // operator's flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set(['analytics:read']);
    renderShell();
    expect(sidebarHrefs()).not.toContain('/analytics');
  });

  it('contributes nothing to an operator without the code its route enforces', () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. The codes are
    // opaque strings, so holding some other module's read code is not holding
    // this one's.
    presentModules = new Set(['analytics']);
    permissions = new Set(['google_analytics:read']);
    renderShell();
    expect(sidebarHrefs()).not.toContain('/analytics');
  });

  it('restores the entry when the module comes back, with no rebuild', () => {
    presentModules = new Set();
    permissions = new Set(['analytics:read']);
    const off = renderShell();
    expect(sidebarHrefs()).not.toContain('/analytics');
    off.unmount();

    presentModules = new Set(['analytics']);
    renderShell();
    expect(sidebarHrefs()).toContain('/analytics');
  });
});

describe('the shell no longer names this module by hand', () => {
  it('has no `/analytics` entry in the host NAV or the host route table', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither mentions this module now, and the screen is still there.
    // The breadcrumb table is the third and is derived rather than enumerated —
    // `registryCrumbs` builds the trail for `/analytics` from the composed
    // sidebar.
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(app).not.toContain('AnalyticsPage');
    expect(app).not.toContain('modules/analytics');
    expect(shell).not.toContain("to: '/analytics'");
    expect(shell).not.toContain('appShell.nav.analytics');
  });

  it('keeps no client-side copy of the module’s palette entry', () => {
    // The palette's Actions group is the server's — it resolves the manifest's
    // `actions` against the effective enabled-set, which is where this module's
    // new entry lives and where its off-state is proven. What the admin must
    // not do is carry a second, hand-written copy in `PALETTE_ITEMS`: that one
    // would keep advertising the screen after an operator switched the module
    // off, because nothing on the server would have been asked.
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(shell).not.toContain("'/analytics'");
  });

  it('resolves the screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-analytics/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('loads its screen lazily, behind a dynamic-import factory', async () => {
    // FR-013. The property is a consequence of the declaration shape: the only
    // function-valued field is a dynamic-import factory, so Vite has a split
    // point whether or not anybody remembers to ask for one.
    const { contributions } = await import('@endora-commerce/mod-analytics/admin');
    const routes = contributions.routes ?? [];
    expect(routes.map((route) => route.path)).toEqual(['/analytics']);
    expect(typeof routes[0]!.component).toBe('function');
    // Awaited directly, with no `waitFor` around it. A dynamic import is not a
    // DOM observation: `waitFor` would put a 1000 ms deadline on vite-node
    // transforming this screen's module graph, and — because its retry loop
    // skips every tick while its callback's promise is still pending — grant
    // exactly one attempt inside that deadline. That is a guillotine, not a
    // retry.
    const loaded = await routes[0]!.component();
    expect(typeof loaded.default).toBe('function');
  });

  it('gates route and sidebar on the code its own API route enforces', async () => {
    // `check:action-route-permissions` holds this module's palette action to
    // the code enforced on its own `targetRoute`; the route and nav
    // declarations are the same statement one layer down, and nothing else
    // compares them. `GET /api/v1/admin/analytics/summary` enforces
    // `analytics:read` and the dashboard writes nothing, so there is one code
    // here and it is the read one.
    const { contributions } = await import('@endora-commerce/mod-analytics/admin');
    expect(contributions.routes?.[0]?.requiredPermission).toBe('analytics:read');
    expect(contributions.nav?.[0]?.requiredPermission).toBe('analytics:read');
  });

  it('orders its sidebar entry before google_analytics’, by weight', async () => {
    // The batch-two fact batch one could not have: two converted modules in one
    // section, so `registryNavFor`'s `weight` ordering has something to order.
    // The hand-written NAV had `/analytics` before `/google-analytics`, and the
    // declared weights restore exactly that — the block's position within the
    // section is still "after the host's own entries", which
    // `AppShell.analytics-nav.test.tsx` records.
    const analytics = await import('@endora-commerce/mod-analytics/admin');
    const google = await import('@endora-commerce/mod-google-analytics/admin');
    const left = analytics.contributions.nav?.[0];
    const right = google.contributions.nav?.[0];
    expect(left?.section).toBe('analyticsAds');
    expect(right?.section).toBe('analyticsAds');
    expect(left!.weight).toBeLessThan(right!.weight);
  });
});
