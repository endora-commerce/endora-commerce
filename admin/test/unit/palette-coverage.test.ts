import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';
import {
  describeFinding,
  paletteCoverageFindings,
  type CoverageAction,
  type CoverageSurface,
  type PaletteCoverageFinding,
  type PaletteLedger,
} from '../helpers/palette-coverage.js';

/**
 * Every admin destination a module contributes is reachable from ⌘K / CTRL+K,
 * or is recorded here as deliberately not a palette target (Principle XVI;
 * issue #510), and every module with an admin page declares at least one
 * palette action of its own (issue #82). The rules are stated in
 * `specs/conventions/module-admin-surfaces.md` § *Command palette*, item 7;
 * the derivation is `admin/test/helpers/palette-coverage.ts`.
 */

/**
 * **The escape hatch.** A static route that is not a top-level screen of its
 * own — a create form its list already opens, a tab of another screen, a
 * legacy address kept for bookmarks — keyed by the module that contributes it,
 * with the reason. Neither a landing route nor a sidebar destination can be
 * exempted. Two-way: an entry whose route gained an action, or stopped being
 * contributed, fails as stale.
 */
const PALETTE_EXEMPTIONS: PaletteLedger = {
  blog: {
    '/blog/categories/new':
      'Create form opened from the category tree (*New category*, *+ Child* with a parent id); the palette carries the tree.',
  },
  cms: {
    '/cms': 'Legacy alias rendering the same page list as /cms/pages, which open-pages advertises.',
    '/cms/blocks/new': 'Create form opened from the block list header; the palette carries the list.',
    '/cms/templates/new': 'Create form opened from the template list header; the palette carries the list.',
  },
  dictionaries: {
    '/dictionaries/audit':
      'Unadvertised legacy spelling of /admin/dictionaries/audit, kept so old bookmarks resolve.',
  },
  inventory: {
    '/warehouses/new': 'Create form opened from the warehouse list header.',
  },
  invoice_ledger: {
    '/invoice-ledger/routing': 'A tab of the ledger screen (RouteTabLink), not a screen of its own.',
  },
  invoices: {
    '/invoices/templates':
      'Redirect to Document templates (spec 152 FR-088), kept so old bookmarks resolve; document_templates advertises the destination.',
  },
  newsletter: {
    '/newsletter/automations/new': 'Create form opened from the automation list header.',
  },
  product_feeds: {
    '/product-feeds/templates/new': 'Create form opened from the feed-template list header.',
  },
  projects: {
    '/projects/templates/new': 'Create form opened from the project-template list header.',
  },
  quote_requests: {
    '/quote-requests/new':
      'Create form opened from the RFQ inbox header and from a CRM opportunity; the palette carries the inbox.',
  },
  returns: {
    '/returns/reasons': 'Configuration sub-screen reached from the returns list, by the module’s own design.',
    '/returns/delivery-methods':
      'Configuration sub-screen reached from the returns list, by the module’s own design.',
  },
};

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ManifestShape {
  readonly id: string;
  readonly actions?: ReadonlyArray<{ readonly id: string; readonly targetRoute: string }>;
}

/**
 * The manifests of every module package the admin depends on, read through
 * each package's own root export rather than through the generated registry,
 * so the registry is reconciled against a second author instead of being
 * reported as itself.
 */
async function loadManifests(): Promise<Map<string, ManifestShape>> {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const names = Object.keys(pkg.dependencies ?? {}).filter((name) =>
    name.startsWith('@endora-commerce/mod-'),
  );
  const manifests = new Map<string, ManifestShape>();
  for (const name of names) {
    const loaded = (await import(/* @vite-ignore */ name)) as { manifest?: ManifestShape };
    if (loaded.manifest === undefined) throw new Error(`${name} exports no \`manifest\``);
    manifests.set(loaded.manifest.id, loaded.manifest);
  }
  return manifests;
}

describe('palette coverage rule (red proofs)', () => {
  const surface = (over: Partial<CoverageSurface> = {}): CoverageSurface => ({
    moduleId: 'widgets',
    routes: [
      { path: '/widgets', index: true },
      { path: '/widgets/:id' },
      { path: '/widgets/new' },
      { path: '/widget-groups' },
    ],
    nav: [{ to: '/widgets' }, { to: '/widget-groups' }],
    ...over,
  });
  const action = (targetRoute: string): CoverageAction => ({
    moduleId: 'widgets',
    id: `go${targetRoute.replaceAll('/', '-')}`,
    targetRoute,
  });
  const all = [action('/widgets'), action('/widgets/new'), action('/widget-groups')];
  const run = (over: {
    surfaces?: CoverageSurface[];
    actions?: CoverageAction[];
    exemptions?: PaletteLedger;
  }): string[] =>
    paletteCoverageFindings({
      surfaces: over.surfaces ?? [surface()],
      actions: over.actions ?? all,
      exemptions: over.exemptions ?? {},
    }).map((f: PaletteCoverageFinding) => `${f.kind} ${f.path}`);
  const reason = 'created from the list header, never on its own';

  it('is clean when every static destination has an action', () => {
    expect(run({})).toEqual([]);
  });

  it('counts an action declared by another module as coverage', () => {
    expect(run({ actions: [action('/widgets'), action('/widgets/new'), { ...action('/widget-groups'), moduleId: 'gadgets' }] })).toEqual([]);
  });

  it('refuses a landing route with no action, and refuses to exempt it', () => {
    expect(
      run({
        actions: [action('/widgets/new'), action('/widget-groups')],
        exemptions: { widgets: { '/widgets': reason } },
      }),
    ).toEqual(['uncovered-landing /widgets', 'stale-exemption /widgets']);
  });

  it('refuses a sidebar entry with no action, and refuses to exempt it', () => {
    expect(
      run({
        actions: [action('/widgets'), action('/widgets/new')],
        exemptions: { widgets: { '/widget-groups': reason } },
      }),
    ).toEqual(['uncovered-sidebar-entry /widget-groups', 'stale-exemption /widget-groups']);
  });

  it('refuses a sidebar entry pointing outside its own routes', () => {
    expect(run({ surfaces: [surface({ nav: [{ to: '/widget-roles' }] })] })).toEqual([
      'uncovered-sidebar-entry /widget-roles',
    ]);
  });

  it('refuses a non-sidebar static route with no action and no exemption', () => {
    expect(run({ actions: [action('/widgets'), action('/widget-groups')] })).toEqual([
      'uncovered-destination /widgets/new',
    ]);
  });

  it('accepts an exemption with a reason for a non-sidebar static route', () => {
    expect(
      run({
        actions: [action('/widgets'), action('/widget-groups')],
        exemptions: { widgets: { '/widgets/new': reason } },
      }),
    ).toEqual([]);
  });

  it('never asks for an action on a parameterised or wildcard route', () => {
    expect(
      run({
        surfaces: [surface({ routes: [{ path: '/widgets/:id/history' }, { path: '/widgets/*' }], nav: [] })],
        // The module's own action, so the per-module rule is met and only
        // the per-destination question is asked of these two routes.
        actions: [action('/widget-search')],
      }),
    ).toEqual([]);
  });

  it('refuses a ledger entry that states no reason', () => {
    expect(
      run({
        actions: [action('/widgets'), action('/widget-groups')],
        exemptions: { widgets: { '/widgets/new': ' ' } },
      }),
    ).toEqual(['entry-without-reason /widgets/new']);
  });

  it('refuses an exemption whose route gained an action', () => {
    expect(run({ exemptions: { widgets: { '/widgets/new': reason } } })).toEqual([
      'stale-exemption /widgets/new',
    ]);
  });

  it('refuses a module with admin pages that declares no action of its own, even when another module covers them', () => {
    const gadgets = (targetRoute: string): CoverageAction => ({ ...action(targetRoute), moduleId: 'gadgets' });
    expect(
      run({ actions: [gadgets('/widgets'), gadgets('/widgets/new'), gadgets('/widget-groups')] }),
    ).toEqual(['module-without-action /widgets']);
  });

  it('refuses a module whose only pages are parameterised and which declares no action', () => {
    expect(
      run({
        surfaces: [surface({ routes: [{ path: '/widgets/:id' }], nav: [] })],
        actions: [],
      }),
    ).toEqual(['module-without-action /widgets/:id']);
  });

  it('asks no action of a module contributing no admin page (zones only)', () => {
    expect(run({ surfaces: [surface({ routes: [], nav: [] })], actions: [] })).toEqual([]);
  });

  it('refuses an exemption for a route no module contributes', () => {
    expect(run({ exemptions: { gadgets: { '/gadgets/new': reason } } })).toEqual([
      'stale-exemption /gadgets/new',
    ]);
  });
});

describe('palette coverage of the real admin registry (Principle XVI)', () => {
  it('reaches every contributed destination from the palette, or records why not', async () => {
    const manifests = await loadManifests();

    // The registry and the dependency list are two authors of one population;
    // a registry entry with no manifest behind it would be a module judged
    // against no actions at all.
    const unmatched = MODULE_ADMIN_CONTRIBUTIONS.map((e) => e.moduleId).filter(
      (id) => !manifests.has(id),
    );
    expect(unmatched, 'registry modules with no manifest among the admin dependencies').toEqual([]);

    const surfaces: CoverageSurface[] = MODULE_ADMIN_CONTRIBUTIONS.map((entry) => ({
      moduleId: entry.moduleId,
      routes: entry.contributions.routes ?? [],
      nav: entry.contributions.nav ?? [],
    }));
    const actions: CoverageAction[] = [...manifests.values()].flatMap((manifest) =>
      (manifest.actions ?? []).map((a) => ({ moduleId: manifest.id, id: a.id, targetRoute: a.targetRoute })),
    );

    // What it read, so a green run cannot mean "read nothing" (issue #113).
    const routeCount = surfaces.reduce((n, s) => n + s.routes.length, 0);
    console.info(
      `[palette-coverage] read: modules=${surfaces.length} routes=${routeCount} ` +
        `actions=${actions.length} sources=manifests:${manifests.size}`,
    );
    expect(surfaces.length).toBeGreaterThan(0);
    expect(routeCount).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(0);

    const findings = paletteCoverageFindings({
      surfaces,
      actions,
      exemptions: PALETTE_EXEMPTIONS,
    });
    expect(findings.map(describeFinding)).toEqual([]);
  });
});
