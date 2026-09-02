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
 * `import_export` is the first module whose admin surface lives in the module
 * (feature 091, Phase 2), and this is the off-state proof
 * `contracts/admin-contribution.md` R15 asks of one.
 *
 * The three things it holds, and each is a property of the **registry** rather
 * than of the screen:
 *
 *  1. the route and the sidebar entry arrive from
 *     `admin/src/modules.generated.ts` — nothing in `App.tsx` or in
 *     `AppShell.tsx`'s `NAV` names this module any more;
 *  2. an operator who switches the module off sees neither, and the gate is the
 *     one existing `isSurfaceVisible` predicate applied at the registry
 *     (FR-011/FR-012), not a check the module wrote for itself;
 *  3. switching it back on restores both, with no rebuild — which is why the
 *     registry does not filter and the render does.
 *
 * The permission axis is asserted beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing.
 */

let presentModules = new Set<string>(['import_export']);
let permissions = new Set<string>(['catalog:write']);



vi.mock('@/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('@/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
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

const { AppShell } = await import('../../src/components/AppShell');

/**
 * The label key resolves in the **module's** namespace, not in `core`. That is
 * the half of the conversion the shared `_i18n` bundle used to own: its
 * `appShell.nav.importExport` entry is gone, and this scope is where the
 * replacement lives.
 */
const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.system',
    'appShell.nav.users',
  ]),
  ...passthroughBundle('import_export', ['nav.importExport.label']),
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

describe('import_export owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    presentModules = new Set(['import_export']);
    permissions = new Set(['catalog:write']);
    renderShell();
    expect(sidebarHrefs()).toContain('/import-export');
    expect(screen.getByRole('link', { name: /nav\.importExport\.label/ })).toBeTruthy();
  });

  it('contributes nothing while the module is switched off', () => {
    // Principle XVII item 5. The registry still names the module — it answers
    // "what could be here" — and the render is what withdraws it, so the
    // operator's flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set(['catalog:write']);
    renderShell();
    expect(sidebarHrefs()).not.toContain('/import-export');
  });

  it('contributes nothing to an operator without the code its routes enforce', () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely.
    presentModules = new Set(['import_export']);
    permissions = new Set();
    renderShell();
    expect(sidebarHrefs()).not.toContain('/import-export');
  });

  it('restores the entry when the module comes back, with no rebuild', () => {
    presentModules = new Set();
    permissions = new Set(['catalog:write']);
    const off = renderShell();
    expect(sidebarHrefs()).not.toContain('/import-export');
    off.unmount();

    presentModules = new Set(['import_export']);
    renderShell();
    expect(sidebarHrefs()).toContain('/import-export');
  });
});

describe('the shell no longer names this module by hand', () => {
  it('has no `/import-export` entry in the host NAV or the host route table', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither mentions this module now, and the screen is still there.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(app).not.toContain('import_export');
    expect(app).not.toContain('ImportExportPage');
    expect(shell).not.toContain("to: '/import-export'");
  });

  it('resolves the screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-import-export/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('loads the screen lazily, so its chunk is not in the entry bundle', async () => {
    // FR-013. The property is a consequence of the declaration shape: the only
    // function-valued field is a dynamic-import factory, so Vite has a split
    // point whether or not anybody remembers to ask for one.
    const { contributions } = await import('@endora-commerce/mod-import-export/admin');
    const route = contributions.routes?.[0];
    expect(route, 'the module declares no route').toBeDefined();
    expect(typeof route!.component).toBe('function');
    // Awaited directly, with no `waitFor` around it. A dynamic import is not a
    // DOM observation: `waitFor` would put a 1000 ms deadline on vite-node
    // transforming this screen's module graph, and — because its retry loop
    // skips every tick while its callback's promise is still pending — grant
    // exactly one attempt inside that deadline. That is a guillotine, not a
    // retry.
    const loaded = await route!.component();
    expect(typeof loaded.default).toBe('function');
  });
});
