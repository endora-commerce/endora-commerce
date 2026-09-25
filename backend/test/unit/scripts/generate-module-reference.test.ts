import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectDocsRegistry,
  emitDocsSidebar,
  emitModuleMap,
  emitModuleReference,
  referenceOf,
  referencePagePaths,
  strayReferencePages,
  type ModuleReference,
} from '../../../scripts/generate-composer.js';
import { resolveDocTitle } from '../../../scripts/lib/docs-title-resolution.js';
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

/**
 * The front-matter block a parser would read off a generated page.
 *
 * `gray-matter` — the parser Docusaurus itself runs — is a transitive
 * dependency of `@docusaurus/core` and resolves from **no** workspace in this
 * repository (`createRequire('backend/').resolve('gray-matter')` and the same
 * from `docs/` both throw `MODULE_NOT_FOUND`), and a new devDependency bought
 * for one assertion is what Constitution IV refuses. Its rule is one sentence
 * and this reproduces it: a `---` fence at **byte 0**, closed by the next `---`
 * line. Everything above that fence is body, which is the whole defect — so a
 * page whose banner comes first parses to `{}` here exactly as it does there.
 *
 * The *title* half of the same rule is asserted beside this through
 * `resolveDocTitle`, which is the instrument `check:docs-translations` runs and
 * therefore the one that decides FR-012 on a real tree.
 */
function frontMatterData(source: string): Record<string, string> {
  if (!source.startsWith('---\n')) {
    return {};
  }
  const lines = source.split('\n');
  const close = lines.indexOf('---', 1);
  if (close === -1) {
    return {};
  }
  const data: Record<string, string> = {};
  for (const line of lines.slice(1, close)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (match !== null) {
      data[match[1]!] = match[2]!;
    }
  }
  return data;
}

describe('a generated page opens with its front matter', () => {
  // Nothing asserted emission **order** before feature 133, which is how this
  // shipped: the "do not edit" banner was emitted above the `---` fence, so the
  // fence opened on line 5, `title`, `sidebar_label` and `description` were
  // inert, and the banner was also the first content node — closing the
  // `contentTitle` route too. Every one of the 75 reference pages and the module
  // map rendered titled `catalog | B2B Platform`, with its own doc id.

  const mapEntries: Parameters<typeof emitModuleMap>[0] = [
    { moduleId: 'catalog', docs: null, shipsFrom: 'core', referenceDocId: 'module-reference/catalog' },
  ];

  const pages: ReadonlyArray<{ label: string; render: (header?: string) => string }> = [
    {
      label: 'a module reference page',
      render: (header) =>
        header === undefined
          ? emitModuleReference(referenceFor(CATALOG))
          : emitModuleReference(referenceFor(CATALOG), header),
    },
    {
      label: 'the module map',
      render: (header) =>
        header === undefined ? emitModuleMap(mapEntries) : emitModuleMap(mapEntries, header),
    },
  ];

  for (const page of pages) {
    describe(page.label, () => {
      it('puts the front matter at byte 0, where front matter is front matter', () => {
        const rendered = page.render();
        expect(rendered[0]).toBe('-');
        expect(rendered.startsWith('---\n')).toBe(true);
      });

      it('parses to a non-empty front matter carrying the fields it declares', () => {
        const data = frontMatterData(page.render());
        expect(Object.keys(data).length).toBeGreaterThan(0);
        expect(data.title).toBeTruthy();
        expect(data.sidebar_label).toBeTruthy();
        expect(data.description).toBeTruthy();
      });

      it('keeps the do-not-edit banner, below the front matter', () => {
        // An HTML comment under the front matter is still a banner to a reader
        // of the source and is invisible in the rendered page. Moving it must
        // not lose it: the banner is what tells an editor their change is undone
        // by the next `composer:generate`, and `overlay:check` byte-compares it.
        const rendered = page.render();
        expect(rendered).toContain('AUTO-GENERATED');
        expect(rendered.indexOf('<!-- AUTO-GENERATED')).toBeGreaterThan(rendered.indexOf('\n---\n'));
      });

      it('resolves a title under the rule check:docs-translations applies', () => {
        expect(resolveDocTitle(page.render())).toEqual({ resolvable: true });
      });

      it('does the same for a caller-supplied banner, which is what an instance emits', () => {
        // `INSTANCE_DOCS_PAGE_HEADER` (`packages/cli/src/generate/index.ts`) is
        // the same emission with another string, so a fix that held only for
        // this repository's banner would leave every client instance defective.
        const instance =
          `<!-- AUTO-GENERATED by \`endora generate\` — DO NOT EDIT, and do not commit. -->`;
        const rendered = page.render(instance);
        expect(rendered[0]).toBe('-');
        expect(rendered).toContain(instance);
        expect(resolveDocTitle(rendered)).toEqual({ resolvable: true });
      });

      it('emits front-matter values YAML can read back, which is what the build parses', () => {
        // The second half of the same defect, and it only became reachable when
        // the first was fixed. `description` is the sentence *"…manifest
        // declares: permissions, …"*, and `: ` inside a plain YAML scalar is an
        // incomplete mapping pair: once the front matter sat at byte 0 and was
        // parsed for the first time, `docusaurus build` died in `gray-matter` on
        // the first generated page — 152 of them, both locales. Nothing here
        // asserted that a value survives the parser, only that it is present.
        const rendered = page.render();
        const lines = rendered.split('\n');
        const block = lines.slice(1, lines.indexOf('---', 1));
        expect(block.length).toBeGreaterThan(0);
        for (const line of block) {
          const value = /^[A-Za-z_][\w-]*:\s*(.*)$/.exec(line)?.[1] ?? '';
          if (value.startsWith('"')) {
            expect(value.endsWith('"')).toBe(true);
            continue;
          }
          // A plain scalar: no `: ` or ` #`, and no leading YAML indicator.
          expect(value).not.toMatch(/[:#]\s/);
          expect(value).not.toMatch(/^[\s>|&*!%@`'[{-]/);
        }
      });
    });
  }

  it('quotes the sentence that broke the build, and quotes nothing that does not need it', () => {
    const rendered = emitModuleReference(referenceFor(CATALOG));
    const data = frontMatterData(rendered);
    // The value carries a colon, so it is double-quoted — and unquoting it
    // returns the sentence the reader sees, not an escaped approximation of it.
    expect(data.description).toMatch(/^".*"$/);
    expect(data.description!.slice(1, -1).split('\\"').join('"')).toBe(
      "Everything the `catalog` module's manifest declares: permissions, palette " +
        'actions, settings, activation and dependencies.',
    );
    // `title` needs none. Quoting it anyway would rewrite 152 tracked pages for
    // nothing, which is why the generator quotes on demand rather than always.
    expect(data.title).toBe('catalog — module reference');
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
    expect(sidebar).toContain(
      "{ type: 'doc', id: 'module-reference/mfa', label: 'mfa', key: 'mfa' },",
    );
  });

  it('names nothing at all for a module that declares docs: false', () => {
    const sidebar = sidebarOver([{ id: 'mfa', declaresNoDocs: true }], []);
    expect(sidebar).not.toContain('mfa');
  });
});
