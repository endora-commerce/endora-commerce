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
 * `linkedin_ads` is half of the **third batch of the drain** (feature 091, Phase 4)
 * and this is the off-state proof `contracts/admin-contribution.md` R15 asks of
 * a converted module.
 *
 * What is this batch's and not batch one's or batch two's:
 *
 *  * **it pays a boundary debt.** Both previous batches took a module with zero
 *    admin cross-module reach in either direction and therefore had nothing to
 *    retire. This module reached `sales_channels`' admin client twice, and
 *    `backend/scripts/ledgers/cross-module-imports/linkedin_ads.ts` recorded both
 *    before any admin directory moved. The exit that shard names is the one
 *    taken — the caller builds the request from the published `apiClient` and
 *    the contract's own types — so `check:module-boundary` reads four fewer
 *    reaches rather than the same number under different keys, and the shard is
 *    deleted rather than emptied;
 *  * **the section it contributes to now holds no host-declared entry at all.**
 *    `/analytics`, `/google-analytics`, `/linkedin-ads` and `/meta-ads` are all
 *    the registry's, so `registryNavFor`'s `weight` is the whole of the order —
 *    asserted in `admin/test/components/AppShell.analytics-nav.test.tsx`, which
 *    is where the four entries can be seen together.
 *
 * The palette half of item 5 is proven server-side, in
 * `backend/test/integration/linkedin_ads/off-state.test.ts`: the Actions group is
 * resolved from the manifest against the effective enabled-set, and no
 * admin-side test can see that. What this file asserts about the palette is
 * only the half that is the admin's — that the shell keeps no hand-written copy
 * of the module's route for the server's answer to disagree with.
 *
 * The permission axis is asserted beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing.
 */

let presentModules = new Set<string>(['linkedin_ads']);
let permissions = new Set<string>(['linkedin_ads:read']);



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
 * `appShell.nav.linkedinAds` entry is gone, and this scope is where the label now lives.
 */
const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.analyticsAds',
    'appShell.section.system',
    'appShell.nav.users',
  ]),
  ...passthroughBundle('linkedin_ads', ['nav.linkedInAds.label']),
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

describe('linkedin_ads owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set(['linkedin_ads']);
    permissions = new Set(['linkedin_ads:read']);
    renderShell();
    expect(sidebarHrefs()).toContain('/linkedin-ads');
    expect(screen.getByRole('link', { name: /nav\.linkedInAds\.label/ })).toBeTruthy();
  });

  it('contributes nothing while the module is switched off', () => {
    // Principle XVII item 5. The registry still names the module — it answers
    // "what could be here" — and the render is what withdraws it, so the
    // operator's flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set(['linkedin_ads:read']);
    renderShell();
    expect(sidebarHrefs()).not.toContain('/linkedin-ads');
  });

  it('contributes nothing to an operator without the code its route enforces', () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. The codes are
    // opaque strings, so holding this module's **write** code is not holding
    // the read code the sidebar entry gates on.
    presentModules = new Set(['linkedin_ads']);
    permissions = new Set(['linkedin_ads:write']);
    renderShell();
    expect(sidebarHrefs()).not.toContain('/linkedin-ads');
  });

  it('restores the entry when the module comes back, with no rebuild', () => {
    presentModules = new Set();
    permissions = new Set(['linkedin_ads:read']);
    const off = renderShell();
    expect(sidebarHrefs()).not.toContain('/linkedin-ads');
    off.unmount();

    presentModules = new Set(['linkedin_ads']);
    renderShell();
    expect(sidebarHrefs()).toContain('/linkedin-ads');
  });
});

describe('the shell no longer names linkedin_ads by hand', () => {
  it('has no host route, nav entry or breadcrumb rule for the module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither mentions this module now, and the screens are still
    // there. The breadcrumb table is the third and is derived rather than
    // enumerated — `registryCrumbs` builds the trail for `/linkedin-ads` from the
    // composed sidebar, which is why the hand-written rule goes with the rest.
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(app).not.toContain('ConversionMapping');
    expect(app).not.toContain('modules/linkedin_ads');
    expect(shell).not.toContain("to: '/linkedin-ads'");
    expect(shell).not.toContain('appShell.nav.linkedinAds');
  });

  it('keeps no client-side copy of the module’s palette entries', () => {
    // The palette's Actions group is the server's — it resolves the manifest's
    // `actions` against the effective enabled-set, which is where this module's
    // two entries live and where their off-state is proven. What the admin must
    // not do is carry a second, hand-written copy in `PALETTE_ITEMS`: that one
    // would keep advertising the screen after an operator switched the module
    // off, because nothing on the server would have been asked.
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(shell).not.toContain("'/linkedin-ads'");
  });

  it('resolves the screens through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-linkedin-ads/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('loads each screen lazily, with one factory behind the two editor routes', async () => {
    // FR-013, and R6's list-plus-editor shape. The only function-valued field is
    // a dynamic-import factory, so Vite has a split point whether or not anybody
    // remembers to ask for one; `/new` and `/:id` share one factory **value**,
    // so the editor is one chunk and not two.
    const { contributions } = await import('@endora-commerce/mod-linkedin-ads/admin');
    const routes = contributions.routes ?? [];
    expect(routes.map((route) => route.path)).toEqual([
      '/linkedin-ads',
      '/linkedin-ads/new',
      '/linkedin-ads/:id',
    ]);
    for (const route of routes) expect(typeof route.component).toBe('function');
    expect(routes[1]!.component).toBe(routes[2]!.component);
    // Awaited directly, with no `waitFor` around it. A dynamic import is not a
    // DOM observation: `waitFor` would put a 1000 ms deadline on vite-node
    // transforming this screen's module graph, and — because its retry loop
    // skips every tick while its callback's promise is still pending — grant
    // exactly one attempt inside that deadline. That is a guillotine, not a
    // retry.
    const loaded = await routes[0]!.component();
    expect(typeof loaded.default).toBe('function');
  });

  it('gates each surface on the code its own API route enforces', async () => {
    // `check:action-route-permissions` holds this module's palette actions to
    // the codes enforced on their own `targetRoute`s; the route and nav
    // declarations are the same statement one layer down, and nothing else
    // compares them. The landing route reads and its editor writes, so the two
    // codes are different and the sidebar — which advertises a destination —
    // takes the read one.
    const { contributions } = await import('@endora-commerce/mod-linkedin-ads/admin');
    const routes = contributions.routes ?? [];
    expect(routes.map((route) => route.requiredPermission)).toEqual([
      'linkedin_ads:read',
      'linkedin_ads:write',
      'linkedin_ads:write',
    ]);
    expect(contributions.nav?.[0]?.requiredPermission).toBe('linkedin_ads:read');
  });

  it('no longer imports another module’s admin client', () => {
    // The batch's own measurement, asserted rather than left to the check. Both
    // screens read the sales channels they label a mapping's channel with, and
    // both used to do it by importing `salesChannelsClient` out of
    // `sales_channels`' admin directory. The ledger shard that recorded the two
    // reaches names the exit taken here — the caller builds the request from
    // the published `apiClient` and the contract's own types — and refuses the
    // one that merely looks like it: a package subpath is the same coupling
    // under a supported name, which is why this asserts on the **specifier**
    // and not on the directory the file sits in.
    const pkg = '../packages/modules/linkedin_ads/src/admin';
    for (const file of [
      `${pkg}/pages/ConversionMappingsListPage.tsx`,
      `${pkg}/pages/ConversionMappingEditPage.tsx`,
      `${pkg}/api/linkedin-ads-client.ts`,
    ]) {
      const source = sourceOf(file);
      // The `@/` alias resolves to `admin/src` and nothing a package can reach.
      expect(source).not.toMatch(/^import .* from '@\//m);
      expect(source).not.toMatch(/^import .* from '.*sales[-_]channels/m);
    }
  });
});
