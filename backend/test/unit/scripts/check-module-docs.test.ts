import { describe, expect, it } from 'vitest';

import {
  checkModuleDocs,
  mapRowsIn,
  MODULES_WITHOUT_DOCUMENTATION,
  navigationEntriesIn,
  PAGES_OUTSIDE_THE_NAVIGATION,
  pageKey,
  type ModuleDocsFindingKind,
} from '../../../scripts/check-module-docs.js';
import {
  attributeDocs,
  categoryPositionOf,
  comparePages,
  contentPathOf,
  labelOf,
  moduleOfSlug,
  parseFrontMatter,
  PAGES_ATTRIBUTED_BY_ALIAS,
  resolveDocsLayout,
} from '../../../scripts/lib/module-docs.js';
import {
  createModuleDocsFixture,
  mapArtefactNaming,
  sidebarArtefactNaming,
  type FixtureModuleDocs,
  type FixturePage,
} from '../../helpers/module-docs-fixture.js';

/**
 * Companion test — `check:module-docs` (feature 100 / roadmap F12,
 * `contracts/docs-registry.md` §3).
 *
 * Every proof enters over a **documentation tree on disk** plus the records a
 * generated index produces over it, and the two committed artefacts as text. That
 * is the top of the analysis (issue #130): the walk, the front-matter parse, the
 * slug fold and the artefact readers are all downstream of it, and a fixture
 * handing in a per-page attribution would prove the reporter and leave all four
 * unproven.
 *
 * The red proofs themselves live in `check-inventory.test.ts` beside the
 * inventory row, in this estate's idiom. What is here is the discrimination each
 * one rests on: that a compliant tree is *clean*, that the two artefact readers
 * read what the generator writes, and that the attribution rules answer the four
 * cases the tree actually holds.
 */

/** A tree in which every module is documented and the navigation reaches it. */
function compliant(): {
  modules: readonly FixtureModuleDocs[];
  pages: readonly FixturePage[];
} {
  return {
    modules: [{ id: 'catalog' }, { id: 'blog' }],
    pages: [
      { path: 'catalog.md', frontMatter: { title: 'Catalog', description: 'Products.' } },
      { path: 'blog/index.md', frontMatter: { title: 'Blog', description: 'Posts.' } },
    ],
  };
}

function run(
  overrides: {
    modules?: readonly FixtureModuleDocs[];
    pages?: readonly FixturePage[];
    navigation?: readonly string[];
    rows?: readonly { moduleId: string; slug?: string | undefined }[];
    aliases?: Readonly<Record<string, { moduleId: string; reason: string }>>;
    ledgers?: {
      undocumented?: Readonly<Record<string, string>>;
      orphans?: Readonly<Record<string, string>>;
    };
  } = {},
): { findings: readonly { kind: ModuleDocsFindingKind; key: string }[] } {
  const base = compliant();
  const modules = overrides.modules ?? base.modules;
  const pages = overrides.pages ?? base.pages;
  const fixture = createModuleDocsFixture(modules, pages);
  try {
    // The alias table is an input and the fixture supplies its own — empty by
    // default. Reading the real one over a synthetic tree would report all four
    // of this repository's aliases stale in every proof, which is a finding
    // about the fixture and not about the predicate.
    const attribution = attributeDocs(
      fixture.pages,
      modules.map((module) => module.id),
      overrides.aliases ?? {},
    );
    const navigation =
      overrides.navigation ??
      attribution.documented.flatMap((entry) =>
        [entry.entry, ...entry.children].map((page) => page.docId),
      );
    const rows =
      overrides.rows ??
      modules.map((module) => ({
        moduleId: module.id,
        slug: attribution.documented.find((entry) => entry.moduleId === module.id)?.slug,
      }));
    return checkModuleDocs({
      modules: fixture.modules,
      attribution,
      navigationEntries: navigationEntriesIn(sidebarArtefactNaming(navigation)),
      mapRows: mapRowsIn(
        mapArtefactNaming(rows),
        modules.map((module) => module.id),
      ),
      ledgers: overrides.ledgers ?? { undocumented: {}, orphans: {} },
    });
  } finally {
    fixture.cleanup();
  }
}

describe('check:module-docs', () => {
  it('is clean over a tree whose navigation describes every registered module', () => {
    expect(run().findings).toEqual([]);
  });

  it('reads the pages the walk produced, not a classification handed in', () => {
    const fixture = createModuleDocsFixture(compliant().modules, compliant().pages);
    try {
      expect(fixture.pages.map((page) => page.docId).sort()).toEqual([
        'modules/blog/index',
        'modules/catalog',
      ]);
      // `inDirectory` is the fact `categoryPositionOf` turns on, and it is read
      // off the tree rather than declared: `blog/index.md` is inside a directory
      // of its own slug's name and `catalog.md` is not.
      expect(fixture.pages.find((page) => page.slug === 'blog')?.inDirectory).toBe(true);
      expect(fixture.pages.find((page) => page.slug === 'catalog')?.inDirectory).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  describe('attribution', () => {
    it('folds a hyphenated slug onto a snake_case module id', () => {
      const registered = new Set(['google_analytics', 'catalog']);
      expect(moduleOfSlug('google-analytics', registered)).toBe('google_analytics');
      expect(moduleOfSlug('catalog', registered)).toBe('catalog');
    });

    it('attributes nothing on a near miss — the fold is equality, not a guess', () => {
      // `dictionary` and `dictionaries` differ by a suffix and the fold does not
      // bridge them. That is why the four Q2 slugs need a declared alias rather
      // than a heuristic: a rule invented to fit four cases is a population
      // defined by whoever wrote it (issue #244).
      expect(moduleOfSlug('dictionary', new Set(['dictionaries']), {})).toBeNull();
      expect(moduleOfSlug('organization-hierarchy', new Set(['organizations']), {})).toBeNull();
    });

    it('attributes a page through the declared alias, and only to a registered module', () => {
      // The alias table is consulted after the fold, and its target has to be a
      // module the index registers — an alias naming a module that has gone
      // attributes nothing rather than inventing one. This repository's own
      // table is the default, so these two also assert that it holds the entry
      // the four Q2 slugs depend on.
      expect(moduleOfSlug('admin-i18n', new Set(['_i18n']))).toBe('_i18n');
      expect(moduleOfSlug('admin-i18n', new Set(['catalog']))).toBeNull();
      expect(moduleOfSlug('admin-i18n', new Set(['_i18n']), {})).toBeNull();
    });

    it('groups a module reached by two slugs into one entry', () => {
      // `organizations` holds its own page and, through the alias,
      // `organization-hierarchy`. Grouping by slug would emit the module twice,
      // which the map's "one row per registered module" cannot represent.
      const fixture = createModuleDocsFixture([{ id: 'organizations' }], [
        { path: 'organizations.md', frontMatter: { title: 'organizations' } },
        { path: 'organization-hierarchy.md', frontMatter: { title: 'Organization hierarchy' } },
      ]);
      try {
        const attribution = attributeDocs(fixture.pages, ['organizations']);
        expect(attribution.documented).toHaveLength(1);
        expect(attribution.documented[0]?.entry.docId).toBe('modules/organizations');
        expect(attribution.documented[0]?.children.map((page) => page.docId)).toEqual([
          'modules/organization-hierarchy',
        ]);
        expect(attribution.unlocated).toEqual([]);
      } finally {
        fixture.cleanup();
      }
    });
  });

  describe('front matter', () => {
    it('reads the four Docusaurus fields and nothing this repository invented', () => {
      const parsed = parseFrontMatter(
        `---\ntitle: Catalog\nsidebar_label: Products\nsidebar_position: 4\ndescription: 'A: capability'\n---\n\n# Catalog\n`,
      );
      expect(parsed).toEqual({
        title: 'Catalog',
        sidebarLabel: 'Products',
        sidebarPosition: 4,
        description: 'A: capability',
      });
    });

    it('reads a page with no block, and a block that is never closed, as carrying none', () => {
      expect(parseFrontMatter('# Catalog\n').title).toBeNull();
      expect(parseFrontMatter('---\ntitle: Catalog\n').title).toBeNull();
    });

    it('falls back label → sidebar_label → title → the module id', () => {
      const page = (frontMatter: Record<string, string>) =>
        ({ frontMatter: parseFrontMatter(`---\n${Object.entries(frontMatter).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`) }) as never;
      expect(labelOf(page({ sidebar_label: 'Products', title: 'Catalog' }), 'catalog')).toBe(
        'Products',
      );
      expect(labelOf(page({ title: 'Catalog' }), 'catalog')).toBe('Catalog');
      expect(labelOf(page({}), 'catalog')).toBe('catalog');
    });

    it("does not read an index page's sidebar_position as its module's place", () => {
      // Every such value in the tree is `1` — an intra-directory ordering, inert
      // under a manual sidebar. Reading it would hoist five modules to the top
      // of the category for a reason nobody wrote.
      const index = { inDirectory: true, frontMatter: parseFrontMatter('---\nsidebar_position: 1\n---\n') };
      const top = { inDirectory: false, frontMatter: parseFrontMatter('---\nsidebar_position: 1\n---\n') };
      expect(categoryPositionOf(index as never)).toBeNull();
      expect(categoryPositionOf(top as never)).toBe(1);
    });

    it('orders by declared position first and then alphabetically by label', () => {
      const items = [
        { position: null, label: 'Blog' },
        { position: 2, label: 'Zebra' },
        { position: null, label: 'Analytics' },
      ];
      expect([...items].sort(comparePages).map((item) => item.label)).toEqual([
        'Zebra',
        'Analytics',
        'Blog',
      ]);
    });
  });

  describe('the two artefact readers', () => {
    it('reads every doc id the sidebar fragment names, in both of its spellings', () => {
      const source =
        "const modules = [\n  { type: 'doc', id: 'modules/catalog', label: 'Catalog' },\n" +
        "  {\n    type: 'category',\n    link: { type: 'doc', id: 'modules/cms/index' },\n" +
        "    items: [\n      'modules/cms/extending-page-builder',\n    ],\n  },\n];\n";
      expect(navigationEntriesIn(source)).toEqual([
        'modules/catalog',
        'modules/cms/extending-page-builder',
        'modules/cms/index',
      ]);
    });

    it('reads a linked row and an unlinked one out of the module map', () => {
      const source = mapArtefactNaming([
        { moduleId: 'catalog', slug: 'catalog' },
        { moduleId: 'mfa' },
      ]);
      expect(mapRowsIn(source, ['catalog', 'mfa'])).toEqual(['catalog', 'mfa']);
    });

    it('resolves a map row through the alias, exactly as the walk resolves the page', () => {
      const source = mapArtefactNaming([{ moduleId: 'admin-i18n', slug: 'admin-i18n' }]);
      expect(mapRowsIn(source, ['_i18n'])).toEqual(['_i18n']);
    });
  });

  describe('the ledgers', () => {
    it('holds the six undocumented modules standing when the check landed', () => {
      expect(Object.keys(MODULES_WITHOUT_DOCUMENTATION).sort()).toEqual([
        'admin_notifications',
        'custom_fields',
        'email',
        'mfa',
        'pim_connector',
        'stripe',
      ]);
      for (const reason of Object.values(MODULES_WITHOUT_DOCUMENTATION)) {
        expect(reason.length).toBeGreaterThan(40);
      }
    });

    it('holds no page outside the navigation, because the generator reaches them all', () => {
      // Eight stood on 2026-09-03. The artefact emits an entry per page, so the
      // ledger lands empty rather than pre-populated — pre-populating it would
      // make eight entries that are stale in the merge request that writes them.
      expect(PAGES_OUTSIDE_THE_NAVIGATION).toEqual({});
    });

    it('holds exactly the four slugs that name no module, each with its retiring condition', () => {
      expect(Object.keys(PAGES_ATTRIBUTED_BY_ALIAS).sort()).toEqual([
        'admin-i18n',
        'dictionary',
        'module-lifecycle',
        'organization-hierarchy',
      ]);
      for (const entry of Object.values(PAGES_ATTRIBUTED_BY_ALIAS)) {
        expect(entry.reason).toMatch(/Q2/);
      }
    });

    it('keys a page ledger entry on the module and the slug, never on a repository path', () => {
      // R4.1. Phase 2 moves 78 pages one module at a time, and a path-keyed
      // entry goes stale on every batch — the shape AGENTS.md records for
      // `module-removal.test.ts`, where the batch that frees an entry is the one
      // that cannot see it go stale.
      const fixture = createModuleDocsFixture([{ id: 'catalog' }], [
        { path: 'catalog/attributes.md', frontMatter: { title: 'Attributes' } },
      ]);
      try {
        const page = fixture.pages[0]!;
        expect(pageKey('catalog', page)).toBe('catalog:catalog/attributes');
        expect(pageKey('catalog', page)).not.toContain(fixture.modulesRoot);
      } finally {
        fixture.cleanup();
      }
    });
  });

  describe('the finding predicates', () => {
    it('exempts a module that declares docs: false and reports one that declares nothing', () => {
      // The distinction the whole design turns on: absent is a module nobody has
      // decided about, `false` is a decision. Collapsing them is how a
      // conditional obligation becomes empty files that exist to pass a check.
      const undeclared = run({
        modules: [{ id: 'catalog' }, { id: 'mfa' }],
        rows: [{ moduleId: 'catalog', slug: 'catalog' }, { moduleId: 'mfa' }],
        pages: [{ path: 'catalog.md', frontMatter: { title: 'Catalog' } }],
      });
      expect(undeclared.findings.map((finding) => finding.kind)).toEqual(['undocumented-module']);

      const declared = run({
        modules: [{ id: 'catalog' }, { id: 'mfa', declaresNoDocs: true }],
        rows: [{ moduleId: 'catalog', slug: 'catalog' }, { moduleId: 'mfa' }],
        pages: [{ path: 'catalog.md', frontMatter: { title: 'Catalog' } }],
      });
      expect(declared.findings).toEqual([]);
    });

    it('reports both directions of the undocumented-module ledger', () => {
      // A ledgered module that now has a page is a finding, so the entry retires
      // in the merge request that wrote the page rather than in a later one.
      const withPage = run({
        modules: [{ id: 'catalog' }, { id: 'mfa' }],
        pages: [
          { path: 'catalog.md', frontMatter: { title: 'Catalog' } },
          { path: 'mfa.md', frontMatter: { title: 'MFA' } },
        ],
        ledgers: { undocumented: { mfa: 'documented in a later merge request' }, orphans: {} },
      });
      expect(withPage.findings.map((finding) => finding.key)).toEqual(['mfa']);
    });

    it('reports a page the committed artefact does not reach', () => {
      const result = run({ navigation: ['modules/catalog'] });
      expect(result.findings).toEqual([
        expect.objectContaining({ kind: 'orphan-page', key: 'blog:blog/index' }),
      ]);
    });

    it('reports a page no module owns, with no way to write an exemption for it', () => {
      const result = run({
        pages: [
          ...compliant().pages,
          { path: 'something-else.md', frontMatter: { title: 'Something else' } },
        ],
      });
      expect(result.findings.map((finding) => finding.kind)).toEqual(['unlocated-page']);
    });

    it('reports both directions of the module map', () => {
      const missingRow = run({ rows: [{ moduleId: 'catalog', slug: 'catalog' }] });
      expect(missingRow.findings).toEqual([
        expect.objectContaining({ kind: 'unpaired-index-row', key: 'blog' }),
      ]);

      const extraRow = run({
        rows: [
          { moduleId: 'catalog', slug: 'catalog' },
          { moduleId: 'blog', slug: 'blog' },
          { moduleId: 'gone' },
        ],
      });
      expect(extraRow.findings).toEqual([
        expect.objectContaining({ kind: 'unpaired-index-row', key: 'gone' }),
      ]);
    });

    it('reports an alias whose page is gone and one the rename made redundant', () => {
      const aliases = {
        'organization-hierarchy': { moduleId: 'organizations', reason: 'Q2.' },
      };
      const gone = attributeDocs([], ['organizations'], aliases);
      expect(gone.staleAliases).toEqual(['organization-hierarchy']);

      const fixture = createModuleDocsFixture([{ id: 'dictionary' }], [
        { path: 'dictionary/index.md', frontMatter: { title: 'Dictionary' } },
      ]);
      try {
        // The slug now folds onto a registered id of its own, so the alias
        // attributes nothing the fold would not. That is the state Q2's rename
        // produces, and it is a finding in the merge request that produces it.
        const attribution = attributeDocs(fixture.pages, ['dictionary'], {
          dictionary: { moduleId: 'dictionaries', reason: 'Q2.' },
        });
        expect(attribution.redundantAliases).toEqual(['dictionary']);
      } finally {
        fixture.cleanup();
      }
    });
  });

  describe('the site layout', () => {
    it("takes the content root from the config's own path, and Docusaurus's default otherwise", () => {
      expect(contentPathOf("presets: [['classic', { docs: { sidebarPath: x } }]]")).toBe('docs');
      expect(contentPathOf("docs: { path: 'content', sidebarPath: x }")).toBe('content');
    });

    it('resolves this repository\'s own site off the workspace declaration', () => {
      const layout = resolveDocsLayout(new URL('../../../..', import.meta.url).pathname);
      expect(layout.modulesRoot.endsWith('/docs/docs/modules')).toBe(true);
    });
  });
});
