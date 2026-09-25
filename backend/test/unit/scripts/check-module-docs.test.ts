import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkModuleDocs,
  collectProsePages,
  DERIVED_FACTS_IN_PROSE,
  derivedFactReferencesIn,
  derivedFactSitesOf,
  loadForeignLinkLedger,
  mapRowsIn,
  MODULES_WITHOUT_DOCUMENTATION,
  moduleTreePrefixes,
  navigationEntriesIn,
  PAGES_OUTSIDE_THE_NAVIGATION,
  pageKey,
  pageLinksOf,
  proseKey,
  vacuousLinkWalkReason,
  sitesOf,
  type DerivedFactSite,
  type ForeignLinkLedger,
  type ModuleDocsFindingKind,
  type PageLink,
} from '../../../scripts/check-module-docs.js';
import {
  attributeDocs,
  categoryPositionOf,
  comparePages,
  contentPathOf,
  labelOf,
  moduleOfSlug,
  parseFrontMatter,
  relativeLinksIn,
  resolveDocsLayout,
  slugNamesModule,
  type DocsAttribution,
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

/**
 * The links a fixture's module-owned pages write, resolved as the real run
 * resolves them.
 *
 * `pageLinksOf` is the run's **own** derivation, called here with the fixture's
 * bytes — read the file, resolve the relative target to a doc id, ask which
 * module owns the page at that id, and record whether the target climbed above
 * the category at all. A second copy of those four steps in the fixture would be
 * a second answer to what a link resolves to, which is the shape this estate
 * refuses; the reader under test produces the proof's population.
 */
function linksOf(attribution: DocsAttribution): PageLink[] {
  return pageLinksOf(attribution, (path) => readFileSync(path, 'utf8'));
}

function run(
  overrides: {
    modules?: readonly FixtureModuleDocs[];
    pages?: readonly FixturePage[];
    navigation?: readonly string[];
    rows?: readonly { moduleId: string; slug?: string | undefined }[];
    links?: readonly PageLink[];
    proseSites?: readonly DerivedFactSite[];
    ledgers?: {
      undocumented?: Readonly<Record<string, string>>;
      orphans?: Readonly<Record<string, string>>;
      foreignLinks?: ForeignLinkLedger;
      derivedFacts?: Readonly<Record<string, string | { sites: number; reason: string }>>;
    };
  } = {},
): { findings: readonly { kind: ModuleDocsFindingKind; key: string }[] } {
  const base = compliant();
  const modules = overrides.modules ?? base.modules;
  const pages = overrides.pages ?? base.pages;
  const fixture = createModuleDocsFixture(modules, pages);
  try {
    const attribution = attributeDocs(
      fixture.pages,
      modules.map((module) => module.id),
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
      links: overrides.links ?? linksOf(attribution),
      proseSites: overrides.proseSites ?? [],
      ledgers: {
        undocumented: {},
        orphans: {},
        foreignLinks: {},
        derivedFacts: {},
        ...overrides.ledgers,
      },
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

    it('strips a leading underscore, because Docusaurus will not route one (D-200)', () => {
      // `_i18n.md` would be a **partial**: no route, and unfindable from
      // `sidebars.js`. The equality rule was recommended without checking the
      // tool and would have produced two missing pages and a broken sidebar.
      expect(moduleOfSlug('i18n', new Set(['_i18n']))).toBe('_i18n');
      expect(moduleOfSlug('lifecycle', new Set(['_lifecycle']))).toBe('_lifecycle');
      expect(slugNamesModule('i18n', '_i18n')).toBe(true);
      expect(slugNamesModule('google-analytics', 'google_analytics')).toBe(true);
    });

    it('attributes nothing on a near miss — the two rules are equality, not a guess', () => {
      // `dictionary` and `dictionaries` differ by a suffix and neither the fold
      // nor the underscore strip bridges them. That is the slip D-200 answered
      // by renaming the page rather than by a heuristic invented to fit it.
      expect(moduleOfSlug('dictionary', new Set(['dictionaries']))).toBeNull();
      expect(moduleOfSlug('organization-hierarchy', new Set(['organizations']))).toBeNull();
      expect(slugNamesModule('lifecycle', '_module_lifecycle')).toBe(false);
    });

    it('attributes a page to the module that ships it, whatever its slug says', () => {
      // The shipper outranks the slug: a module's own declaration of what it
      // ships cannot be beaten by a derivation from a file name. It is what
      // retired the four-entry alias table, and what lets `organizations` own a
      // second slug with nothing declared anywhere.
      const fixture = createModuleDocsFixture(
        [
          {
            id: 'organizations',
            docs: [
              { path: 'organizations.md', frontMatter: { title: 'Organizations' } },
              { path: 'organization-hierarchy.md', frontMatter: { title: 'Hierarchy' } },
            ],
          },
        ],
        [],
      );
      try {
        const attribution = attributeDocs(fixture.pages, ['organizations']);
        expect(attribution.unlocated).toEqual([]);
        expect(attribution.misowned).toEqual([]);
        expect(attribution.documented[0]?.entry.docId).toBe('modules/organizations');
        expect(attribution.documented[0]?.children.map((page) => page.docId)).toEqual([
          'modules/organization-hierarchy',
        ]);
      } finally {
        fixture.cleanup();
      }
    });

    it('groups a module reached by two slugs into one entry', () => {
      // A module can own two slugs. Grouping by slug would emit the module
      // twice, which the map's "one row per registered module" cannot
      // represent. In the site's own tree the second slug names no module, so
      // this case is the *shipper*'s: it is the module's `docs/` layer that
      // groups them.
      const fixture = createModuleDocsFixture(
        [
          {
            id: 'organizations',
            docs: [
              { path: 'organizations.md', frontMatter: { title: 'organizations' } },
              {
                path: 'organization-hierarchy.md',
                frontMatter: { title: 'Organization hierarchy' },
              },
            ],
          },
        ],
        [],
      );
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

    it("resolves a map row by D-200's rule, exactly as the walk resolves the page", () => {
      const source = mapArtefactNaming([{ moduleId: 'i18n', slug: 'i18n' }]);
      expect(mapRowsIn(source, ['_i18n'])).toEqual(['_i18n']);
    });
  });

  describe('the ledgers', () => {
    it('holds the undocumented modules that remain in this repository', () => {
      expect(Object.keys(MODULES_WITHOUT_DOCUMENTATION).sort()).toEqual([
        'admin_notifications',
        'custom_fields',
        'email',
        'mfa',
        'pim_connector',
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

    it('holds the foreign-module links standing when Phase 2 moved the pages', async () => {
      // Per consumer module, keyed on the target module — a cut that removes a
      // module's last cross-module link touches that module's file and nobody
      // else's. Two-way: an unledgered link fails, and so does an entry the
      // walk no longer finds.
      const ledger = await loadForeignLinkLedger();
      expect(Object.keys(ledger).length).toBeGreaterThan(0);
      for (const [consumer, targets] of Object.entries(ledger)) {
        expect(Object.keys(targets).length).toBeGreaterThan(0);
        for (const [target, entry] of Object.entries(targets)) {
          expect(target).not.toBe(consumer);
          expect(sitesOf(entry)).toBeGreaterThan(0);
          expect(typeof entry === 'string' ? entry : entry.reason).toMatch(/FR-020|sibling/);
        }
      }
    });

    it('holds the sentences that state where a module lives, each with a reason', () => {
      // Expected to empty: every entry is a sentence somebody should rewrite to
      // name the module instead of its address. It arrives pre-populated because
      // a check that lands red is reverted rather than read — and the population
      // is not the one this feature predicted, which is recorded rather than
      // quietly corrected: `spec.md` § 0.3 measured 50 occurrences over 25 files
      // of `backend/src/modules/`, and the SC-005 sweep repaired almost all of
      // them into `packages/modules/` — the same derived fact, one address later.
      const keys = Object.keys(DERIVED_FACTS_IN_PROSE);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        // R4.1/R4.2 — the page's own doc id and a digest of the sentence. Never a
        // repository path, and never a line: an insertion above the site must not
        // red the entry, and an edited sentence must.
        expect(key).toMatch(/^[A-Za-z0-9_./-]+#[0-9a-f]{8}$/);
        const entry = DERIVED_FACTS_IN_PROSE[key]!;
        expect(sitesOf(entry)).toBeGreaterThan(0);
        expect((typeof entry === 'string' ? entry : entry.reason).length).toBeGreaterThan(40);
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

  describe('the derived-fact predicate', () => {
  const prefixes = moduleTreePrefixes(
    new Map([
      ['catalog', '/repo/packages/modules/catalog'],
      ['blog', '/repo/packages/modules/blog'],
      ['_lifecycle', '/repo/packages/platform/src/lifecycle'],
    ]),
    '/repo',
  );

  it('derives both a module tree and a single module directory, and nothing wider', () => {
    // "Two or more" is what keeps `packages/platform/src` out of the tree set
    // while `_lifecycle` sits under it: one module does not make a tree, and a
    // prefix that broad would report every platform citation as a module path.
    expect([...prefixes].map((prefix) => `${prefix.kind} ${prefix.path}`).sort()).toEqual([
      'module packages/modules/blog',
      'module packages/modules/catalog',
      'module packages/platform/src/lifecycle',
      'tree packages/modules',
    ]);
  });

  it('reads a module address out of prose, in the three spellings the tree writes', () => {
    const found = derivedFactReferencesIn(
      [
        'The body is `packages/modules/catalog/src/backend/cli/reindex.ts`.',
        'Put it at `packages/modules/<id>/src/manifest.ts`.',
        'It lives at `packages/platform/src/lifecycle/`.',
      ].join('\n'),
      prefixes,
    ).map((entry) => entry.reference);
    expect(found).toEqual([
      'packages/modules/catalog/src/backend/cli/reindex.ts',
      'packages/modules/<id>/src/manifest.ts',
      'packages/platform/src/lifecycle',
    ]);
  });

  it('counts one sentence naming one module once, whichever prefixes cover it', () => {
    // `packages/modules/catalog/...` is under a module prefix *and* under the
    // tree prefix. Counting it twice would make every ledger count wrong by
    // construction, and the count is one half of a two-way ratchet.
    expect(
      derivedFactReferencesIn('See `packages/modules/catalog/src/manifest.ts`.', prefixes),
    ).toHaveLength(1);
  });

  it('says nothing about a path that names no module', () => {
    // The rule is *where a module's code lives*, not "a path in prose". A
    // predicate that could not tell the two apart would arrive with a ledger
    // that is mostly exceptions.
    expect(
      derivedFactReferencesIn(
        [
          'The kernel is `packages/platform/src/kernel/compose.ts`.',
          'Its tests are `backend/test/unit/catalog/pricing.test.ts`.',
          'The contract is `packages/contracts/src/catalog.ts`.',
        ].join('\n'),
        prefixes,
      ),
    ).toEqual([]);
  });

  it('groups a sentence naming two modules into one site with two references', () => {
    const sites = derivedFactSitesOf(
      { docId: 'deployment/checklist', path: '/repo/docs/docs/deployment/checklist.md' },
      'See `packages/modules/catalog/src/manifest.ts` and `packages/modules/blog/src/manifest.ts`.',
      prefixes,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]!.references).toHaveLength(2);
  });

  it('keys on the page and a digest of the sentence, never on a line', () => {
    // R4.2 — an insertion above the site must not red the entry, and an edited
    // sentence must.
    expect(proseKey('architecture/kernel', 'a sentence')).toMatch(
      /^architecture\/kernel#[0-9a-f]{8}$/,
    );
    expect(proseKey('architecture/kernel', 'a sentence')).not.toBe(
      proseKey('architecture/kernel', 'a sentence.'),
    );
  });

  it('walks the whole site, and never an artefact or a copy', () => {
    // FR-018's rule, one walk over: a finding has to land on a file an author
    // can edit. The module map and the generated reference pages are this
    // repository's own output, and the copies under the modules category are a
    // second spelling of a page whose source is the module's.
    const fixture = createModuleDocsFixture(
      [{ id: 'catalog' }],
      [
        { path: 'catalog.md', frontMatter: { title: 'Catalog' } },
        { path: 'module-map.generated.md', frontMatter: { title: 'Module map' } },
      ],
    );
    try {
      const category = fixture.modulesRoot;
      const pages = collectProsePages(fixture.contentRoot, new Set([join(category, 'catalog.md')]));
      expect(pages.map((page) => page.docId)).toEqual([]);
      expect(collectProsePages(fixture.contentRoot).map((page) => page.docId)).toEqual([
        'modules/catalog',
      ]);
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

    it('reports a page a module ships under a sibling module\'s slug', () => {
      // Shipper and subject disagree: `catalog` publishing at `blog`'s address
      // takes a slug the sibling owns, and if `blog` ever ships that page the
      // copy has two sources for one target. The page stays attributed to its
      // shipper and the disagreement is reported rather than resolved.
      const result = run({
        modules: [
          { id: 'catalog', docs: [{ path: 'blog.md', frontMatter: { title: 'Catalog' } }] },
          { id: 'blog', docs: [{ path: 'blog-2.md', frontMatter: { title: 'Blog' } }] },
        ],
        pages: [],
        rows: [
          { moduleId: 'catalog', slug: 'blog' },
          { moduleId: 'blog', slug: 'blog-2' },
        ],
      });
      expect(result.findings.map((finding) => finding.kind)).toContain('misowned-page');
      expect(
        result.findings.find((finding) => finding.kind === 'misowned-page')?.key,
      ).toBe('modules/blog');
    });

    it('reports a page Docusaurus will not route, in both segment positions', () => {
      // An underscore-prefixed file is a partial: no route, unfindable from the
      // sidebar. `orphan-page` would call it reached, because the artefact does
      // name it and only the build knows it generates nothing.
      const file = run({
        modules: [{ id: 'catalog', docs: [{ path: '_catalog.md', frontMatter: { title: 'C' } }] }],
        pages: [],
        rows: [{ moduleId: 'catalog', slug: '_catalog' }],
      });
      expect(file.findings.map((finding) => finding.kind)).toContain('unroutable-page');

      const directory = run({
        modules: [
          { id: 'catalog', docs: [{ path: '_catalog/index.md', frontMatter: { title: 'C' } }] },
        ],
        pages: [],
        rows: [{ moduleId: 'catalog', slug: '_catalog' }],
      });
      expect(directory.findings.map((finding) => finding.kind)).toContain('unroutable-page');
    });

    it("reports a module page's relative link into a sibling module's page", () => {
      const result = run({
        modules: [
          {
            id: 'catalog',
            docs: [
              {
                path: 'catalog.md',
                frontMatter: { title: 'Catalog' },
                body: 'See [blog](./blog/index.md) and [again](./blog/index.md).',
              },
            ],
          },
          { id: 'blog', docs: [{ path: 'blog/index.md', frontMatter: { title: 'Blog' } }] },
        ],
        pages: [],
        rows: [
          { moduleId: 'catalog', slug: 'catalog' },
          { moduleId: 'blog', slug: 'blog' },
        ],
      });
      expect(result.findings).toEqual([
        expect.objectContaining({ kind: 'foreign-module-link', key: 'catalog:blog' }),
      ]);
    });

    it("does not report a module's link into its own pages", () => {
      const result = run({
        modules: [
          {
            id: 'catalog',
            docs: [
              {
                path: 'catalog.md',
                frontMatter: { title: 'Catalog' },
                body: 'See [attrs](./catalog/attributes.md).',
              },
              {
                path: 'catalog/attributes.md',
                frontMatter: { title: 'Attributes' },
                body: 'Back up to [catalog](../catalog.md), which is still inside the category.',
              },
            ],
          },
          { id: 'blog', docs: [{ path: 'blog/index.md', frontMatter: { title: 'Blog' } }] },
        ],
        pages: [],
        rows: [
          { moduleId: 'catalog', slug: 'catalog' },
          { moduleId: 'blog', slug: 'blog' },
        ],
      });
      expect(result.findings).toEqual([]);
    });

    // The new target position, and the one the sibling sweep waved through for
    // as long as it existed: `toModule === null` was `continue`, so a link into
    // the site's own tree was classified by nothing at all. It is reported per
    // **site** — the page and the link as written — because there is no ledger
    // to key and that pair is what an author needs to rewrite the sentence.
    it("reports a module page's relative link into the site's own tree", () => {
      const result = run({
        modules: [
          {
            id: 'catalog',
            docs: [
              {
                path: 'catalog.md',
                frontMatter: { title: 'Catalog' },
                body: 'See [fields](../architecture/custom-fields.md).',
              },
            ],
          },
          { id: 'blog', docs: [{ path: 'blog/index.md', frontMatter: { title: 'Blog' } }] },
        ],
        pages: [],
        rows: [
          { moduleId: 'catalog', slug: 'catalog' },
          { moduleId: 'blog', slug: 'blog' },
        ],
      });
      expect(result.findings).toEqual([
        expect.objectContaining({
          kind: 'site-tree-link',
          key: 'modules/catalog -> ../architecture/custom-fields.md',
        }),
      ]);
    });

    // The same defect written from a sub-page, where it takes **two** `..` to
    // leave the category and the first one is an ordinary sibling hop. A
    // depth-blind predicate — one that keyed on the literal `../` prefix rather
    // than on where the path resolves — would report the sub-page's link into
    // its own module as a finding and miss this one.
    it('reports it from a sub-page, where the first `..` is still inside the category', () => {
      const result = run({
        modules: [
          {
            id: 'catalog',
            docs: [
              { path: 'catalog.md', frontMatter: { title: 'Catalog' } },
              {
                path: 'catalog/attributes.md',
                frontMatter: { title: 'Attributes' },
                body: 'Up to [catalog](../catalog.md), out to [fields](../../architecture/x.md).',
              },
            ],
          },
          { id: 'blog', docs: [{ path: 'blog/index.md', frontMatter: { title: 'Blog' } }] },
        ],
        pages: [],
        rows: [
          { moduleId: 'catalog', slug: 'catalog' },
          { moduleId: 'blog', slug: 'blog' },
        ],
      });
      expect(result.findings).toEqual([
        expect.objectContaining({
          kind: 'site-tree-link',
          key: 'modules/catalog/attributes -> ../../architecture/x.md',
        }),
      ]);
    });

    // The discrimination that says the predicate is *where the target resolves*
    // and not *the doc id came back null*. A link to the category **root** also
    // resolves to no doc id, and every instance has that page because the
    // generator writes it — so reading `toModule === null` as the finding would
    // report a link that is correct everywhere.
    it('says nothing about a link to the modules category root', () => {
      const result = run({
        modules: [
          {
            id: 'catalog',
            docs: [
              { path: 'catalog.md', frontMatter: { title: 'Catalog' } },
              {
                path: 'catalog/attributes.md',
                frontMatter: { title: 'Attributes' },
                body: 'See the [module index](../.).',
              },
            ],
          },
          { id: 'blog', docs: [{ path: 'blog/index.md', frontMatter: { title: 'Blog' } }] },
        ],
        pages: [],
        rows: [
          { moduleId: 'catalog', slug: 'catalog' },
          { moduleId: 'blog', slug: 'blog' },
        ],
      });
      expect(result.findings).toEqual([]);
    });

    // The refusal that keeps this kind honest. `site-tree-link` has no ledger to
    // go loudly stale, so a walk that resolved no link at all would print a
    // clean line over every page in every package — #237's shape, where `files`
    // holds steady while the syntax walk goes blind.
    it('refuses a link walk that came back empty, and passes one that did not', () => {
      expect(vacuousLinkWalkReason([], '/docs/modules')).toContain('/docs/modules');
      expect(vacuousLinkWalkReason([], '/docs/modules')).toContain('no ledger');
      expect(
        vacuousLinkWalkReason(
          [
            {
              fromModule: 'catalog',
              fromDocId: 'modules/catalog',
              toModule: null,
              toDocId: null,
              target: '../architecture/x.md',
              leavesCategory: true,
            },
          ],
          '/docs/modules',
        ),
      ).toBeNull();
    });

    // The two kinds are reported apart, over one page, because they differ in
    // fate: the sibling link drains through a ledger as each module's author
    // rewrites a sentence, and the site-tree link has no ledger and no instance
    // in which it resolves. One kind over both would make the second wait on the
    // first's drain.
    it('reports a sibling link and a site-tree link on one page as two kinds', () => {
      const result = run({
        modules: [
          {
            id: 'catalog',
            docs: [
              {
                path: 'catalog.md',
                frontMatter: { title: 'Catalog' },
                body: 'See [blog](./blog/index.md) and [fields](../architecture/x.md).',
              },
            ],
          },
          { id: 'blog', docs: [{ path: 'blog/index.md', frontMatter: { title: 'Blog' } }] },
        ],
        pages: [],
        rows: [
          { moduleId: 'catalog', slug: 'catalog' },
          { moduleId: 'blog', slug: 'blog' },
        ],
      });
      expect(result.findings.map((finding) => finding.kind).sort()).toEqual([
        'foreign-module-link',
        'site-tree-link',
      ]);
    });

    it('reports both directions of the foreign-link ledger, count included', () => {
      const tree = {
        modules: [
          {
            id: 'catalog',
            docs: [
              {
                path: 'catalog.md',
                frontMatter: { title: 'Catalog' },
                body: 'See [blog](./blog/index.md).',
              },
            ],
          },
          { id: 'blog', docs: [{ path: 'blog/index.md', frontMatter: { title: 'Blog' } }] },
        ],
        pages: [],
        rows: [
          { moduleId: 'catalog', slug: 'catalog' },
          { moduleId: 'blog', slug: 'blog' },
        ],
      } as const;

      const ledgered = run({
        ...tree,
        ledgers: {
          undocumented: {},
          orphans: {},
          foreignLinks: { catalog: { blog: 'FR-020 — one link.' } },
        },
      });
      expect(ledgered.findings).toEqual([]);

      // A count that no longer describes the walk is the stale entry one
      // granularity down, and it fails just as loudly as an unrecorded link.
      const wrongCount = run({
        ...tree,
        ledgers: {
          undocumented: {},
          orphans: {},
          foreignLinks: { catalog: { blog: { sites: 4, reason: 'FR-020.' } } },
        },
      });
      expect(wrongCount.findings.map((finding) => finding.key)).toEqual(['catalog:blog']);

      const retired = run({
        ...tree,
        ledgers: {
          undocumented: {},
          orphans: {},
          foreignLinks: {
            catalog: { blog: 'FR-020.' },
            blog: { catalog: 'FR-020 — a link nobody writes any more.' },
          },
        },
      });
      expect(retired.findings.map((finding) => finding.key)).toEqual(['blog:catalog']);
    });

    it('reports a sentence that states where a module lives, and its stale entry', () => {
    const site: DerivedFactSite = {
      docId: 'architecture/kernel',
      path: '/repo/docs/docs/architecture/kernel.md',
      line: 'The body lives in `packages/modules/catalog/src/backend/cli/reindex.ts`.',
      references: ['packages/modules/catalog/src/backend/cli/reindex.ts'],
    };
    const key = proseKey(site.docId, site.line);
    expect(run({ proseSites: [site] }).findings).toEqual([
      expect.objectContaining({ kind: 'derived-fact-in-prose', key }),
    ]);
    expect(run({ proseSites: [site], ledgers: { derivedFacts: { [key]: 'FR-023.' } } }).findings)
      .toEqual([]);
    // The other direction: an entry for a sentence nobody writes any more.
    expect(
      run({ ledgers: { derivedFacts: { 'architecture/kernel#deadbeef': 'FR-023.' } } }).findings,
    ).toEqual([
      expect.objectContaining({ kind: 'derived-fact-in-prose', key: 'architecture/kernel#deadbeef' }),
    ]);
  });

  it('reports a ledger count that no longer describes the sentence, in both directions', () => {
    const site: DerivedFactSite = {
      docId: 'deployment/checklist',
      path: '/repo/docs/docs/deployment/checklist.md',
      line: 'See `packages/modules/catalog/src/manifest.ts` and `packages/modules/blog/`.',
      references: ['packages/modules/catalog/src/manifest.ts', 'packages/modules/blog'],
    };
    const key = proseKey(site.docId, site.line);
    const under = run({ proseSites: [site], ledgers: { derivedFacts: { [key]: 'FR-023.' } } });
    expect(under.findings.map((finding) => finding.kind)).toEqual(['derived-fact-in-prose']);
    const exact = run({
      proseSites: [site],
      ledgers: { derivedFacts: { [key]: { sites: 2, reason: 'FR-023.' } } },
    });
    expect(exact.findings).toEqual([]);
    const over = run({
      proseSites: [site],
      ledgers: { derivedFacts: { [key]: { sites: 3, reason: 'FR-023.' } } },
    });
    expect(over.findings.map((finding) => finding.kind)).toEqual(['derived-fact-in-prose']);
  });

  it('resolves a relative link the way Docusaurus does, and stops at the category edge', () => {
      const page = {
        relativePath: 'catalog/attributes.md',
      } as never;
      expect(
        relativeLinksIn(page, 'a [x](../catalog.md) b [y](./attribute-sets.md#anchor) c [z](../../a/b)'),
      ).toEqual([
        { target: '../catalog.md', docId: 'modules/catalog', leavesCategory: false },
        {
          target: './attribute-sets.md#anchor',
          docId: 'modules/catalog/attribute-sets',
          leavesCategory: false,
        },
        { target: '../../a/b', docId: null, leavesCategory: true },
      ]);
    });

    // The resolver keeps the two null-doc-id states apart, which is the whole of
    // what `site-tree-link` rests on: a link that **left** the category names a
    // page only this repository's site has, and a link to the category **root**
    // names one every instance has. Both come back with no doc id.
    it('tells a link that left the category from one that resolved to its root', () => {
      const page = { relativePath: 'catalog/attributes.md' } as never;
      expect(relativeLinksIn(page, 'a [x](../../architecture/y.md) b [y](../.)')).toEqual([
        { target: '../../architecture/y.md', docId: null, leavesCategory: true },
        { target: '../.', docId: null, leavesCategory: false },
      ]);
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
