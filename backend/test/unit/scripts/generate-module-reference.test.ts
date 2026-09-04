import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectDocsRegistry,
  emitDocsSidebar,
  emitModuleReference,
  referenceOf,
  referencePagePaths,
  strayReferencePages,
  type ModuleReference,
} from '../../../scripts/generate-composer.js';
import { ModulePackageError, type ModulePackage } from '../../../scripts/lib/module-packages.js';
import {
  attributeDocs,
  MODULE_REFERENCE_CATEGORY,
  slugForModule,
  slugNamesModule,
  type DocsLayout,
} from '../../../scripts/lib/module-docs.js';
import { createModuleDocsFixture } from '../../helpers/module-docs-fixture.js';

/**
 * The generated reference page, one per module (feature 100 Phase 3, FR-022 and
 * FR-024; `contracts/docs-registry.md`).
 *
 * Everything a reference page renders is in the module's manifest already and
 * was documented nowhere a reader could find, so every module author who wanted
 * it wrote the table by hand — which is `spec.md` § 0.3's fifty stale sentences.
 * Two properties make the generated page worth having and both are proven here:
 * it is rendered **from the manifest and nothing else**, and it renders the same
 * bytes twice, which is what lets `overlay:check` hold it to `stale`.
 *
 * Every proof enters at the top of the analysis (issue #130): a manifest
 * **object**, as `import()` hands one over, or a documentation tree on disk. A
 * fixture supplying a pre-built {@link ModuleReference} would prove the markdown
 * writer and leave the reader — which is the half that decides whether a
 * permission code reaches the page at all — unproven.
 */

/** A manifest module, as `import('<module>/manifest.ts')` resolves to one. */
function manifestModule(
  manifest: Record<string, unknown>,
  cliCommands?: readonly { name: string; summary: string }[],
): { manifest: Record<string, unknown>; cliCommands?: readonly { name: string; summary: string }[] } {
  return cliCommands === undefined ? { manifest } : { manifest, cliCommands };
}

const CATALOG = manifestModule({
  id: 'catalog',
  name: 'Catalog',
  version: '1.2.0',
  dependencies: ['settings', 'sales_channels'],
  activation: { settingCode: 'catalog.enabled', default: true },
  permissions: [
    { code: 'catalog:write', label: 'Write catalog' },
    { code: 'catalog:read', label: 'Read catalog', requires: ['settings:read'] },
  ],
  actions: [
    { id: 'open-products', targetRoute: '/products', requiredPermission: 'catalog:read' },
  ],
  settings: {
    moduleCode: 'catalog',
    settings: [
      { code: 'catalog.page_size', name: 'Page size', valueType: 'number' },
      { code: 'catalog.enabled', name: 'Catalog enabled', valueType: 'boolean' },
    ],
  },
  i18n: { bundlesDir: 'i18n' },
});

function referenceFor(
  loaded: ReturnType<typeof manifestModule>,
  shipsFrom = '@endora-commerce/mod-catalog',
  prosePage: string | null = '../modules/catalog.md',
): ModuleReference {
  return referenceOf('catalog', loaded, shipsFrom, prosePage);
}

describe('the reference page reads the manifest', () => {
  it('renders every fact FR-022 names, from the manifest and nothing else', () => {
    const page = emitModuleReference(referenceFor(CATALOG));

    // Permissions and their labels, the palette actions with the route each
    // opens, the settings codes, the activation control **and its default**,
    // the dependencies, and the package that ships it — FR-022's list, in full.
    expect(page).toContain('| `catalog:read` | Read catalog | `settings:read` |');
    expect(page).toContain('| `open-products` | `/products` | `catalog:read` |');
    expect(page).toContain('| `catalog.page_size` | Page size | `number` |');
    expect(page).toContain('the setting `catalog.enabled`, and it defaults to **on**');
    expect(page).toContain('| `settings` | yes |');
    expect(page).toContain('| Ships from | `@endora-commerce/mod-catalog` |');
  });

  it('says an activation default is off when the manifest says so', () => {
    // The default is asserted, never assumed — a page that read "on" for every
    // module would be a sentence nobody could rely on, which is worse than no
    // sentence at all.
    const off = referenceFor(
      manifestModule({
        id: 'catalog',
        name: 'Catalog',
        version: '1.0.0',
        activation: { settingCode: 'catalog.enabled', default: false },
      }),
    );
    expect(emitModuleReference(off)).toContain('defaults to **off**');
  });

  it('renders a module the platform refuses to switch off as locked, with its reason', () => {
    const locked = referenceFor(
      manifestModule({
        id: 'catalog',
        name: 'Catalog',
        version: '1.0.0',
        activation: { nonDeactivatable: true, reason: 'Every surface reads its products.' },
      }),
    );
    const page = emitModuleReference(locked);
    expect(page).toContain('**This module cannot be switched off.** Every surface reads its');
    expect(page).not.toContain('/platform/modules');
  });

  it('keeps the three kinds of dependency apart, because they bind differently', () => {
    // `dependencies` binds the operator, `acknowledgedDependencies` is a real
    // port edge withheld from the install order, and a non-binding edge does not
    // stop the owner being switched off at all. A page that ran the three
    // together would tell an operator that switching a module off is refused
    // when it is not.
    const page = emitModuleReference(
      referenceFor(
        manifestModule({
          id: 'catalog',
          name: 'Catalog',
          version: '1.0.0',
          dependencies: ['settings'],
          acknowledgedDependencies: [
            { moduleId: 'orders', port: 'orderReadPort', reason: 'a cycle in the install order' },
          ],
          nonBindingDependencies: [
            {
              moduleId: 'search',
              name: 'searchIndexPort',
              kind: 'degrades-without',
              whenAbsent: 'products are listed unindexed',
              reason: 'search is optional',
            },
          ],
        }),
      ),
    );
    expect(page).toContain('| `settings` | yes |');
    expect(page).toContain('| `orders` | gating only | resolves `orderReadPort`');
    expect(page).toContain(
      '| `search` | no | degrades-without `searchIndexPort` — products are listed unindexed |',
    );
  });

  it('names the module operator commands the manifest exports', () => {
    const page = emitModuleReference(
      referenceFor(
        manifestModule({ id: 'catalog', name: 'Catalog', version: '1.0.0' }, [
          { name: 'reindex', summary: 'Rebuild the product index.' },
        ]),
      ),
    );
    expect(page).toContain('| `pnpm --filter backend run cli -- catalog reindex` |');
  });

  it('links the module prose page where there is one, and the map where there is not', () => {
    // A **link**, not a doc id: Docusaurus resolves a link naming the `.md`
    // file to that file's permalink, and a doc id written into a markdown link
    // 404s under `onBrokenLinks: 'throw'`.
    expect(emitModuleReference(referenceFor(CATALOG))).toContain('](../modules/catalog.md)');
    const undocumented = emitModuleReference(referenceFor(CATALOG, 'core', null));
    expect(undocumented).toContain('](../modules/module-map.generated.md)');
    expect(undocumented).toContain('Nobody has written a page about what this module *does* yet');
  });

  it('says so where a module declares nothing, rather than leaving the section out', () => {
    // A section that vanishes is indistinguishable from a section the renderer
    // forgot. "None" is a fact about the manifest; an absent heading is not.
    const bare = emitModuleReference(
      referenceFor(manifestModule({ id: 'catalog', name: 'Catalog', version: '1.0.0' })),
    );
    expect(bare).toContain('## Permissions\n\n_None._');
    expect(bare).toContain('This module declares no translation bundles.');
    expect(bare).toContain('This module declares no activation control');
  });
});

describe('the reference page renders the same bytes twice', () => {
  it('sorts every list, so a manifest that declares them in another order renders identically', () => {
    // `overlay:check` renders an artefact twice and byte-compares, and a page
    // ordered by whatever order a manifest's arrays happen to be in would be
    // deterministic here and drift the moment somebody reordered a declaration
    // — a `stale` verdict for a change that says nothing.
    const reordered = manifestModule({
      ...CATALOG.manifest,
      dependencies: ['sales_channels', 'settings'],
      permissions: [...(CATALOG.manifest.permissions as unknown[])].reverse(),
      settings: {
        moduleCode: 'catalog',
        settings: [...(CATALOG.manifest.settings as { settings: unknown[] }).settings].reverse(),
      },
    });
    expect(emitModuleReference(referenceFor(reordered))).toEqual(
      emitModuleReference(referenceFor(CATALOG)),
    );
  });

  it('escapes a manifest sentence carrying a pipe, so one reason cannot break a table', () => {
    const page = emitModuleReference(
      referenceFor(
        manifestModule({
          id: 'catalog',
          name: 'Catalog',
          version: '1.0.0',
          permissions: [{ code: 'catalog:read', label: 'Read | browse' }],
        }),
      ),
    );
    expect(page).toContain('| `catalog:read` | Read \\| browse | — |');
  });
});

describe('which modules get a page', () => {
  const layout = { contentRoot: '/site/docs' } as DocsLayout;
  const manifest = (id: string, declaresNoDocs = false) =>
    ({ id, declaresNoDocs }) as unknown as Parameters<typeof referencePagePaths>[1][number];

  it('names the page after the module, by the same rule that attributes one back', () => {
    // D-200's fold, applied the other way round. A leading underscore may not
    // survive into the file name: Docusaurus excludes such a file from routing
    // by design, so the page would generate no route and be unreachable from
    // the sidebar that names it.
    for (const id of ['catalog', 'google_analytics', '_i18n', '_lifecycle']) {
      expect(slugNamesModule(slugForModule(id), id)).toBe(true);
    }
    expect(slugForModule('_i18n')).toBe('i18n');
    expect([...referencePagePaths(layout, [manifest('google_analytics')]).values()]).toEqual([
      join('/site/docs', MODULE_REFERENCE_CATEGORY, 'google-analytics.md'),
    ]);
  });

  it('owes no page to a module that declares docs: false', () => {
    // `false` is a decision and owes nothing (R3.1). Generating a page for a
    // module that declared it documents nothing is the platform overruling the
    // module's own declaration.
    expect([...referencePagePaths(layout, [manifest('mfa', true)]).keys()]).toEqual([]);
  });

  it('refuses two modules folding onto one slug rather than writing one over the other', () => {
    expect(() => referencePagePaths(layout, [manifest('_i18n'), manifest('i18n')])).toThrow(
      ModulePackageError,
    );
  });
});

describe('a page in the category that no module claims', () => {
  it('is reported, because nothing else in the estate walks this category', () => {
    // The `orphan-page` state one category over: a module removed leaves a
    // committed page describing a module the platform no longer composes, in no
    // navigation and reachable by URL. `check:module-docs` cannot see it — its
    // population is the modules category — so the generator refuses.
    const root = mkdtempSync(join(tmpdir(), 'module-reference-'));
    try {
      const directory = join(root, 'docs', MODULE_REFERENCE_CATEGORY);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'catalog.md'), '# catalog\n', 'utf8');
      writeFileSync(join(directory, 'coupons.md'), '# coupons\n', 'utf8');
      const layout = { contentRoot: join(root, 'docs') } as DocsLayout;
      expect(strayReferencePages(layout, new Set([join(directory, 'catalog.md')]))).toEqual([
        join(directory, 'coupons.md'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads an empty category, and a category that is not there, as holding nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'module-reference-'));
    try {
      const layout = { contentRoot: join(root, 'docs') } as DocsLayout;
      expect(strayReferencePages(layout, new Set())).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the navigation reaches every reference page', () => {
  const packages: readonly ModulePackage[] = [];

  function sidebarOver(
    modules: readonly { id: string; declaresNoDocs?: boolean }[],
    pages: readonly { path: string; frontMatter?: Record<string, string> }[],
  ): string {
    const fixture = createModuleDocsFixture(modules, pages);
    try {
      const ids = modules.map((module) => module.id);
      return emitDocsSidebar(
        collectDocsRegistry(
          ids,
          attributeDocs(fixture.pages, ids),
          packages,
          new Set(modules.filter((m) => m.declaresNoDocs === true).map((m) => m.id)),
        ),
      );
    } finally {
      fixture.cleanup();
    }
  }

  it('hangs a documented module reference under that module, after its own sub-pages', () => {
    const sidebar = sidebarOver(
      [{ id: 'catalog' }],
      [
        { path: 'catalog.md', frontMatter: { title: 'Catalog' } },
        { path: 'catalog/attributes.md', frontMatter: { title: 'Attributes' } },
      ],
    );
    expect(sidebar).toContain("'modules/catalog/attributes',\n      'module-reference/catalog',");
  });

  it('gives a module nobody has written about an entry of its own', () => {
    // Otherwise the page is findable only by guessing a URL — `spec.md` § 0.2's
    // measured defect, arriving through the artefact meant to answer it.
    const sidebar = sidebarOver([{ id: 'mfa' }], []);
    expect(sidebar).toContain("{ type: 'doc', id: 'module-reference/mfa', label: 'mfa' },");
  });

  it('names nothing at all for a module that declares docs: false', () => {
    const sidebar = sidebarOver([{ id: 'mfa', declaresNoDocs: true }], []);
    expect(sidebar).not.toContain('mfa');
  });
});
