import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CODE_JSON_FILE,
  CONTENT_DOCS_CURRENT_FILE,
  THEME_CLASSIC_FOOTER_FILE,
  THEME_CLASSIC_NAVBAR_FILE,
  chromeMessagesFor,
  requiredSidebarMessageIds,
  type DocsChromeConfig,
} from '../../../scripts/lib/docs-chrome-messages.js';
import {
  defaultTranslationCacheLayout,
  docIdFromSourcePath,
  cacheEntryPath,
  hashSourceBody,
  materializedDocPath,
  writeCacheEntry,
  type TranslationCacheEntry,
} from '../../../scripts/lib/docs-translation-cache.js';
import {
  collectAllDocsTranslationSources,
  collectTranslateCommandSources,
  headingOutline,
  sidebarMessageIdsIn,
  type DocsTranslationSource,
} from '../../../scripts/lib/docs-translation-sources.js';
import type { DocPage } from '../../../scripts/lib/module-docs.js';
import { resolveDocTitle } from '../../../scripts/lib/docs-title-resolution.js';
import {
  checkDocsTranslations,
  type DocsTranslationCheckInput,
} from '../../../scripts/check-docs-translations.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/docs-translations-pre-fix',
);

/**
 * The four artefacts of T001, captured from `36c4f560a` before any task of
 * feature 133 touched a translation file, the Docusaurus configuration or the
 * page generator — and pinned here, because after the chrome seam lands they no
 * longer exist in this shape. A fixture "refreshed" from the fixed tree fails
 * this assertion by design: the pin is a provenance claim about where the
 * fixture came from (FR-043 step 2, `contracts/published-artefact.md` §3).
 */
const PRE_FIX_FIXTURE_SHA256: Readonly<Record<string, string>> = {
  'code.json': 'a938fc43f4f12dded024d22b619ed803ccbf239ff0eb3d1fd012da496216c85d',
  'config-key-set.json': 'f15f5d26594266519a2146239145a82c3aa67d34fb855a6725e58c0373a80a6e',
  'intro.pl.md': '41f2f4930ef939fd09132d0f67566f8b22dbb19658d5e10fa4718e1528c12a50',
  'module-reference-catalog.md':
    'bb249f92a0e2bb5db915a6cbc291e6a73886ff4b21debd1af6cc65fc82a869f5',
};

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

function layout(root: string) {
  return defaultTranslationCacheLayout(root);
}

function writeEnglish(root: string, sourcePath: string, body: string): DocsTranslationSource {
  const absolutePath = join(root, sourcePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  const content = `---\ntitle: Sample\n---\n\n${body}\n`;
  writeFileSync(absolutePath, content, 'utf8');
  return { sourcePath, absolutePath };
}

/** An English source written verbatim — the caller owns every byte, front matter included. */
function writeEnglishVerbatim(
  root: string,
  sourcePath: string,
  content: string,
): DocsTranslationSource {
  const absolutePath = join(root, sourcePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
  return { sourcePath, absolutePath };
}

function baseInput(
  root: string,
  sources: readonly DocsTranslationSource[],
  overrides: Partial<DocsTranslationCheckInput> = {},
): DocsTranslationCheckInput {
  return {
    repoRoot: root,
    defaultLocale: 'en',
    translateLocales: ['pl'],
    sources,
    sidebarMessageIds: [],
    chromeMessages: [],
    inertNamespaces: [],
    skipPaths: new Set(),
    layout: layout(root),
    readTranslationFile: () => ({}),
    ...overrides,
  };
}

/** Write the Polish page where Docusaurus reads it — the translation itself. */
function writeMaterialized(
  root: string,
  locale: string,
  sourcePath: string,
  content: string,
): string {
  const target = materializedDocPath(locale, docIdFromSourcePath(sourcePath), layout(root));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

function seedTranslation(
  root: string,
  source: DocsTranslationSource,
  polishBody: string,
  locale = 'pl',
): TranslationCacheEntry {
  const english = readFileSync(source.absolutePath, 'utf8');
  const entry: TranslationCacheEntry = {
    sourcePath: source.sourcePath,
    sourceHash: hashSourceBody(english),
    locale,
    meta: { provider: 'manual', updatedAt: '2026-09-17T08:00:00.000Z' },
  };
  writeCacheEntry(entry, layout(root));
  writeMaterialized(root, locale, source.sourcePath, `---\ntitle: Sample\n---\n\n${polishBody}\n`);
  return entry;
}

/** Seed a translation whose Polish content is handed in verbatim, front matter included. */
function seedTranslationVerbatim(
  root: string,
  source: DocsTranslationSource,
  polish: string,
  locale = 'pl',
): TranslationCacheEntry {
  const english = readFileSync(source.absolutePath, 'utf8');
  const entry: TranslationCacheEntry = {
    sourcePath: source.sourcePath,
    sourceHash: hashSourceBody(english),
    locale,
    meta: { provider: 'manual', updatedAt: '2026-09-17T08:00:00.000Z' },
  };
  writeCacheEntry(entry, layout(root));
  writeMaterialized(root, locale, source.sourcePath, polish);
  return entry;
}

describe('check-docs-translations', () => {
  it('reports missing-translation when no cache entry exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      const result = checkDocsTranslations(baseInput(root, [source]));
      expect(result.findings.map((finding) => finding.kind)).toEqual(['missing-translation']);
      expect(result.findings[0]?.detail).toBe('missing-translation:docs/docs/intro.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports stale-translation when the cache hash no longer matches English', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      const english = readFileSync(source.absolutePath, 'utf8');
      const entry: TranslationCacheEntry = {
        sourcePath: source.sourcePath,
        sourceHash: hashSourceBody(`${english}\nChanged.`),
        locale: 'pl',
        meta: { provider: 'manual', updatedAt: '2026-09-17T08:00:00.000Z' },
      };
      writeCacheEntry(entry, layout(root));
      writeMaterialized(root, 'pl', source.sourcePath, '---\ntitle: Sample\n---\n\nWitamy.\n');

      const result = checkDocsTranslations(baseInput(root, [source]));
      expect(result.findings.map((finding) => finding.kind)).toEqual(['stale-translation']);
      expect(result.findings[0]?.detail).toBe('stale-translation:docs/docs/intro.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports missing-translation when the pin is fresh but no page is materialised', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      writeCacheEntry(
        {
          sourcePath: source.sourcePath,
          sourceHash: hashSourceBody(readFileSync(source.absolutePath, 'utf8')),
          locale: 'pl',
          meta: { provider: 'manual', updatedAt: '2026-09-17T08:00:00.000Z' },
        },
        layout(root),
      );
      const result = checkDocsTranslations(baseInput(root, [source]));
      expect(result.findings.map((finding) => finding.detail)).toEqual([
        'missing-translation:docs/docs/intro.md',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // --- Issue #671: the pin is the whole of the cache entry -----------------------------------

  it('reads the materialised page as the translation — a Polish-only edit needs no re-pin (#671)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-pin-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      seedTranslation(root, source, 'Witamy.');
      // A wording fix to the Polish page alone: the English body did not move, so
      // the pin is still true and nothing else holds a copy that could disagree.
      writeMaterialized(root, 'pl', source.sourcePath, '---\ntitle: Sample\n---\n\nWitajcie.\n');
      expect(checkDocsTranslations(baseInput(root, [source])).findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports malformed-pin for an entry that still duplicates the page (#671)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-pin-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      const entry = seedTranslation(root, source, 'Witamy.');
      // What a branch cut before #671 merges back in: a fresh hash, plus the page.
      writeFileSync(
        cacheEntryPath('pl', source.sourcePath, layout(root)),
        `${JSON.stringify({ ...entry, content: '---\ntitle: Sample\n---\n\nWitamy.\n' }, null, 2)}\n`,
        'utf8',
      );
      const result = checkDocsTranslations(baseInput(root, [source]));
      expect(result.findings.map((finding) => finding.detail)).toEqual([
        'malformed-pin:docs/docs/intro.md:unexpected-key:content',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports malformed-pin for a pin left with merge-conflict markers (#671)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-pin-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      seedTranslation(root, source, 'Witamy.');
      writeFileSync(
        cacheEntryPath('pl', source.sourcePath, layout(root)),
        '{\n<<<<<<< HEAD\n  "sourceHash": "a",\n=======\n  "sourceHash": "b",\n>>>>>>> other\n}\n',
        'utf8',
      );
      const result = checkDocsTranslations(baseInput(root, [source]));
      expect(result.findings.map((finding) => finding.detail)).toEqual([
        'malformed-pin:docs/docs/intro.md:invalid-json',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('materializes fixture sources to the Docusaurus i18n tree and passes when complete', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-layout-'));
    const paths = layout(root);
    try {
      const handAuthored = writeEnglish(root, 'docs/docs/architecture/kernel.md', 'Kernel guide.');
      const moduleOwned = writeEnglish(
        root,
        'packages/modules/catalog/docs/catalog.md',
        'Catalog usage.',
      );
      const generatedReferenceAbsolute = join(root, 'docs/docs/module-reference/catalog.md');
      mkdirSync(join(generatedReferenceAbsolute, '..'), { recursive: true });
      writeFileSync(
        generatedReferenceAbsolute,
        '---\ntitle: Sample\n---\n\nReference page.\n',
        'utf8',
      );
      const generatedReference: DocsTranslationSource = {
        sourcePath: 'generated:module-reference/catalog',
        absolutePath: generatedReferenceAbsolute,
      };

      for (const source of [handAuthored, moduleOwned, generatedReference]) {
        seedTranslation(root, source, 'Polish body.');
        const docId = docIdFromSourcePath(source.sourcePath);
        expect(materializedDocPath('pl', docId, paths)).toBe(
          join(root, 'docs/i18n/pl/docusaurus-plugin-content-docs/current', `${docId}.md`),
        );
      }

      const result = checkDocsTranslations(
        baseInput(root, [handAuthored, moduleOwned, generatedReference]),
      );
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires a Polish sidebar message after a generated sidebar label change (User Story 4 scenario 3)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-sidebar-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      seedTranslation(root, source, 'Witamy.');

      const beforeLabelChange = `
        { type: 'category', label: 'catalog', key: 'catalog',
          link: { type: 'doc', id: 'modules/catalog' },
          items: ['module-reference/catalog'] },
      `;
      const afterLabelChange = `
        { type: 'category', label: 'Catalog module', key: 'catalog',
          link: { type: 'doc', id: 'modules/catalog' },
          items: ['module-reference/catalog'] },
      `;

      const messageId = 'sidebar.main.category.catalog';
      expect(sidebarMessageIdsIn(beforeLabelChange)).toContain(messageId);
      expect(sidebarMessageIdsIn(afterLabelChange)).toContain(messageId);

      const missing = checkDocsTranslations(
        baseInput(root, [source], {
          sidebarMessageIds: [messageId],
          readTranslationFile: () => ({}),
        }),
      );
      expect(missing.findings.map((finding) => finding.detail)).toContain(
        `missing-sidebar-message:pl/${CONTENT_DOCS_CURRENT_FILE}:${messageId}`,
      );

      const complete = checkDocsTranslations(
        baseInput(root, [source], {
          sidebarMessageIds: [messageId],
          readTranslationFile: (_locale, file) =>
            file === CONTENT_DOCS_CURRENT_FILE ? { [messageId]: { message: 'Katalog' } } : {},
        }),
      );
      expect(complete.findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // --- T008: `missing-sidebar-message` reads the file the plugin reads ---------------------

  it('reads sidebar messages from current.json, not code.json (T008)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-current-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      seedTranslation(root, source, 'Witamy.');
      const messageId = 'sidebar.main.category.architecture';

      // The shipped defect exactly: the id is in `code.json` and nowhere else.
      const inCodeJsonOnly = checkDocsTranslations(
        baseInput(root, [source], {
          sidebarMessageIds: [messageId],
          readTranslationFile: (_locale, file) =>
            file === CODE_JSON_FILE ? { [messageId]: { message: 'Architektura' } } : null,
        }),
      );
      expect(inCodeJsonOnly.findings.map((finding) => finding.detail)).toContain(
        `missing-sidebar-message:pl/${CONTENT_DOCS_CURRENT_FILE}:${messageId}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires no sidebar.main.doc.* id anywhere — bare doc items are translatable:false (T008)', () => {
    expect(
      requiredSidebarMessageIds([
        'sidebar.main.category.architecture',
        'sidebar.main.doc.intro',
        'sidebar.main.doc.architecture/permissions',
      ]),
    ).toEqual(['sidebar.main.category.architecture']);
  });

  // --- T004: the expected id set is derived, never listed ----------------------------------

  it('derives the chrome id set from the pinned pre-fix themeConfig and sidebars (T004)', () => {
    const config = JSON.parse(fixture('config-key-set.json')) as DocsChromeConfig;
    const messages = chromeMessagesFor(config);
    const idsIn = (file: string) =>
      messages.filter((message) => message.file === file).map((message) => message.id);

    expect(idsIn(THEME_CLASSIC_NAVBAR_FILE)).toEqual(['item.label.Docs', 'title']);
    expect(idsIn(THEME_CLASSIC_FOOTER_FILE)).toEqual(['copyright']);

    const sidebarIds = idsIn(CONTENT_DOCS_CURRENT_FILE);
    expect(sidebarIds.filter((id) => /^sidebar\.main\.category\.[^.]+$/.test(id))).toHaveLength(77);
    expect(sidebarIds.filter((id) => id.endsWith('.link.generated-index.title'))).toEqual([
      'sidebar.main.category.architecture.link.generated-index.title',
      'sidebar.main.category.deployment.link.generated-index.title',
      'sidebar.main.category.integrations.link.generated-index.title',
      'sidebar.main.category.operations.link.generated-index.title',
      'sidebar.main.category.runbooks.link.generated-index.title',
    ]);
    // T008 again, at the derivation: a bare doc item carries no translatable id.
    expect(sidebarIds.filter((id) => id.includes('.doc.'))).toEqual([]);

    // The `theme.`-prefixed spelling the shipped `code.json` used is what makes the
    // config-derived id findable in the file it may not live in.
    const navbarTitle = messages.find(
      (message) => message.file === THEME_CLASSIC_NAVBAR_FILE && message.id === 'title',
    );
    expect(navbarTitle?.codeJsonKeys).toContain('theme.navbar.title');
  });

  // --- T005: `chrome-message-missing` -------------------------------------------------------

  it('reports chrome-message-missing for a derived id absent from the file Docusaurus reads (T005)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-chrome-missing-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      seedTranslation(root, source, 'Witamy.');
      const config = JSON.parse(fixture('config-key-set.json')) as DocsChromeConfig;

      const result = checkDocsTranslations(
        baseInput(root, [source], {
          chromeMessages: chromeMessagesFor(config),
          // The pre-fix tree: none of the three theme/plugin translation files exists.
          readTranslationFile: () => null,
        }),
      );
      const details = result.findings
        .filter((finding) => finding.kind === 'chrome-message-missing')
        .map((finding) => finding.detail);
      expect(details).toContain(`chrome-message-missing:pl/${THEME_CLASSIC_NAVBAR_FILE}:title`);
      expect(details).toContain(`chrome-message-missing:pl/${THEME_CLASSIC_FOOTER_FILE}:copyright`);
      expect(details).toContain(
        `chrome-message-missing:pl/${CONTENT_DOCS_CURRENT_FILE}:sidebar.main.category.architecture.link.generated-index.title`,
      );

      const present = checkDocsTranslations(
        baseInput(root, [source], {
          chromeMessages: chromeMessagesFor(config),
          readTranslationFile: (_locale, file) =>
            Object.fromEntries(
              chromeMessagesFor(config)
                .filter((message) => message.file === file)
                .map((message) => [message.id, { message: 'x' }]),
            ),
        }),
      );
      expect(present.findings.filter((finding) => finding.kind === 'chrome-message-missing')).toEqual(
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not report chrome-message-missing for an id missing-sidebar-message already owns', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-one-finding-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      seedTranslation(root, source, 'Witamy.');
      const messageId = 'sidebar.main.category.architecture';

      const result = checkDocsTranslations(
        baseInput(root, [source], {
          sidebarMessageIds: [messageId],
          chromeMessages: [
            { id: messageId, file: CONTENT_DOCS_CURRENT_FILE, codeJsonKeys: [messageId] },
          ],
          readTranslationFile: () => null,
        }),
      );
      // One defect, one finding: the id is `missing-sidebar-message`'s population.
      expect(result.findings.map((finding) => finding.kind)).toEqual(['missing-sidebar-message']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // --- T006: `chrome-message-inert`, and the boundary that matters --------------------------

  it('reports chrome-message-inert for a config-derived id parked in code.json (T006)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-inert-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      seedTranslation(root, source, 'Witamy.');
      const config = JSON.parse(fixture('config-key-set.json')) as DocsChromeConfig;
      const codeJson = JSON.parse(fixture('code.json')) as Record<string, unknown>;

      const result = checkDocsTranslations(
        baseInput(root, [source], {
          chromeMessages: chromeMessagesFor(config),
          inertNamespaces: ['sidebar.main.'],
          readTranslationFile: (_locale, file) => (file === CODE_JSON_FILE ? codeJson : null),
        }),
      );
      const details = result.findings
        .filter((finding) => finding.kind === 'chrome-message-inert')
        .map((finding) => finding.detail);
      expect(details).toContain(`chrome-message-inert:pl/${CODE_JSON_FILE}:theme.navbar.title`);
      expect(details).toContain(`chrome-message-inert:pl/${CODE_JSON_FILE}:theme.footer.copyright`);
      expect(details).toContain(
        `chrome-message-inert:pl/${CODE_JSON_FILE}:sidebar.main.category.architecture`,
      );
      // Every one of the 116 inert `sidebar.main.doc.*` ids is in the namespace, whether
      // or not today's `sidebars.js` still derives it — 10 of them no longer do.
      expect(details).toContain(`chrome-message-inert:pl/${CODE_JSON_FILE}:sidebar.main.doc.intro`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves a component-emitted id in code.json alone — that is its home (T003 boundary)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-boundary-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      seedTranslation(root, source, 'Witamy.');
      const config = JSON.parse(fixture('config-key-set.json')) as DocsChromeConfig;

      // Ids `@docusaurus/theme-classic`'s own components emit through `<Translate>`,
      // plus the shape the search plugin adds in the search seam. `code.json` is where
      // Docusaurus reads every one of them from, so none may be reported.
      const componentEmitted: Record<string, unknown> = {
        'theme.docs.sidebar.collapseButtonTitle': { message: 'Zwiń panel boczny' },
        'theme.docs.sidebar.navAriaLabel': { message: 'Panel boczny dokumentacji' },
        'theme.NotFound.title': { message: 'Nie znaleziono strony' },
        'theme.common.skipToMainContent': { message: 'Przejdź do treści głównej' },
        'theme.SearchBar.label': { message: 'Szukaj' },
      };

      const result = checkDocsTranslations(
        baseInput(root, [source], {
          chromeMessages: chromeMessagesFor(config),
          inertNamespaces: ['sidebar.main.'],
          readTranslationFile: (_locale, file) =>
            file === CODE_JSON_FILE ? componentEmitted : null,
        }),
      );
      expect(result.findings.filter((finding) => finding.kind === 'chrome-message-inert')).toEqual(
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // --- T007: `doc-title-unresolvable`, per locale -------------------------------------------

  it('resolves a title from front matter at byte 0, or from a leading heading', () => {
    expect(resolveDocTitle('---\ntitle: Catalog\n---\n\nBody.\n')).toEqual({ resolvable: true });
    expect(resolveDocTitle('---\nsidebar_position: 1\n---\n\n# Catalog\n')).toEqual({
      resolvable: true,
    });
    expect(resolveDocTitle('# Catalog\n\nBody.\n')).toEqual({ resolvable: true });
    expect(resolveDocTitle('---\nsidebar_position: 1\n---\n\n:::note\nHi\n:::\n')).toEqual({
      resolvable: false,
      reason: 'no-title-and-no-heading',
    });
    expect(resolveDocTitle('<!-- banner -->\n---\ntitle: Catalog\n---\n\n# Catalog\n')).toEqual({
      resolvable: false,
      reason: 'front-matter-not-at-byte-0',
    });
    // A thematic break in prose is not front matter that arrived late.
    expect(resolveDocTitle('# Catalog\n\nBody.\n\n---\n\nMore body.\n')).toEqual({
      resolvable: true,
    });
  });

  it('reports doc-title-unresolvable per locale over the pre-fix artefacts (T007)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-title-'));
    try {
      // The generated reference page as it shipped: banner on lines 1-4, `---` on line 5.
      const generatedAbsolute = join(root, 'docs/docs/module-reference/catalog.md');
      mkdirSync(dirname(generatedAbsolute), { recursive: true });
      writeFileSync(generatedAbsolute, fixture('module-reference-catalog.md'), 'utf8');
      const generated: DocsTranslationSource = {
        sourcePath: 'generated:module-reference/catalog',
        absolutePath: generatedAbsolute,
      };
      seedTranslationVerbatim(root, generated, fixture('module-reference-catalog.md'));

      // The home page: English resolves a title from its `# ` heading, Polish does not,
      // because its first content node is the translation-policy admonition.
      const intro = writeEnglishVerbatim(
        root,
        'docs/docs/intro.md',
        '---\nsidebar_position: 1\nslug: /\n---\n\n# B2B Platform — Introduction\n\nWelcome.\n',
      );
      seedTranslationVerbatim(root, intro, fixture('intro.pl.md'));

      const result = checkDocsTranslations(baseInput(root, [generated, intro]));
      const details = result.findings
        .filter((finding) => finding.kind === 'doc-title-unresolvable')
        .map((finding) => finding.detail);

      expect(details).toEqual([
        'doc-title-unresolvable:docs/docs/module-reference/catalog.md:front-matter-not-at-byte-0',
        'doc-title-unresolvable:docs/i18n/pl/docusaurus-plugin-content-docs/current/intro.md:no-title-and-no-heading',
        'doc-title-unresolvable:docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/catalog.md:front-matter-not-at-byte-0',
      ]);
      // The English home page is not a finding — the same rule, evaluated per locale.
      expect(details).not.toContain(
        'doc-title-unresolvable:docs/docs/intro.md:no-title-and-no-heading',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // --- T002: provenance of the fixtures ------------------------------------------------------

  it('pins the sha256 of every pre-fix fixture (T002)', () => {
    for (const [name, expected] of Object.entries(PRE_FIX_FIXTURE_SHA256)) {
      const digest = createHash('sha256')
        .update(readFileSync(join(FIXTURE_DIR, name)))
        .digest('hex');
      expect(digest, `${name} is not the artefact captured from the pre-fix tree`).toBe(expected);
    }
  });

  // --- Issue #676: the hand-authored pages under docs/docs/modules/ --------------------------

  it('counts the hand-authored pages under the modules category, never the module copies (#676)', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-sources-modules-'));
    try {
      const contentRoot = join(root, 'docs/docs');
      const modulesRoot = join(contentRoot, 'modules');
      writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      writeEnglish(root, 'docs/docs/modules/README.md', 'Backend modules.');
      writeEnglish(root, 'docs/docs/modules/lifecycle.md', 'Lifecycle.');
      writeEnglish(root, 'docs/docs/modules/module-map.generated.md', 'Module map.');
      // What `composer:generate` copies in: present on a developer's disk, absent
      // from a fresh checkout — the population must be the same size on both.
      const modulePages: DocPage[] = [];
      for (const relativePath of ['catalog.md', 'catalog/attributes.md']) {
        const owned = writeEnglish(root, `packages/modules/catalog/docs/${relativePath}`, 'Owned.');
        writeEnglish(root, `docs/docs/modules/${relativePath}`, 'Owned.');
        modulePages.push({ path: owned.absolutePath, relativePath } as DocPage);
      }

      const all = collectAllDocsTranslationSources(root, contentRoot, modulesRoot, modulePages);
      expect(all.map((source) => source.sourcePath)).toEqual([
        'docs/docs/intro.md',
        'docs/docs/modules/lifecycle.md',
        'docs/docs/modules/module-map.generated.md',
        'docs/docs/modules/README.md',
        'packages/modules/catalog/docs/catalog.md',
        'packages/modules/catalog/docs/catalog/attributes.md',
      ]);

      // The maintainer translate walk takes the hand-authored pages too, and
      // leaves the generated module map to its own layer.
      const translate = collectTranslateCommandSources(root, contentRoot, modulePages);
      expect(translate.map((source) => source.sourcePath)).toEqual([
        'docs/docs/intro.md',
        'docs/docs/modules/lifecycle.md',
        'docs/docs/modules/README.md',
        'packages/modules/catalog/docs/catalog.md',
        'packages/modules/catalog/docs/catalog/attributes.md',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('check-docs-translations — structural divergence (issue #1340)', () => {
  const english = [
    '## Public surface',
    '',
    'Text.',
    '',
    '## One Save on the screen {#one-save}',
    '',
    '```bash',
    '# Install the module',
    'pnpm install',
    '```',
    '',
    '### Migrations',
  ].join('\n');

  const polish = [
    '## API publiczne',
    '',
    'Tekst.',
    '',
    '## Jeden przycisk Zapisz na ekranie {#one-save}',
    '',
    '```bash',
    '# Zainstaluj moduł',
    '# Druga linia komentarza, której nie ma w wersji angielskiej',
    'pnpm install',
    '```',
    '',
    '### Migracje',
  ].join('\n');

  function run(englishBody: string, polishBody: string) {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', englishBody);
      seedTranslation(root, source, polishBody);
      return checkDocsTranslations(baseInput(root, [source]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('reads level and explicit anchor, ignoring front matter and fenced code', () => {
    expect(
      headingOutline(`---\ntitle: T\n---\n\n# Title\n\n~~~sh\n# not a heading\n~~~\n\n## A {#a}\n### B ##\n`),
    ).toEqual([
      { level: 1, anchor: null, id: 'title' },
      { level: 2, anchor: 'a', id: 'a' },
      { level: 3, anchor: null, id: 'b' },
    ]);
  });

  it('derives the slug Docusaurus renders for a heading without an explicit anchor', () => {
    expect(
      headingOutline('## Sales channels\n## The `organizations` [module](./x.md)\n## Sales channels\n'),
    ).toEqual([
      { level: 2, anchor: null, id: 'sales-channels' },
      { level: 2, anchor: null, id: 'the-organizations-module' },
      { level: 2, anchor: null, id: 'sales-channels-1' },
    ]);
  });

  it('pairs a Polish explicit anchor with the English heading whose derived slug it repeats', () => {
    const result = run(
      `${english}\n\n## Switching the module off\n`,
      `${polish}\n\n## Wyłączanie modułu {#switching-the-module-off}\n`,
    );
    expect(result.findings).toEqual([]);
  });

  it('reports a Polish anchor that matches no English heading id', () => {
    const result = run(
      `${english}\n\n## Switching the module off\n`,
      `${polish}\n\n## Wyłączanie modułu {#wylaczanie-modulu}\n`,
    );
    expect(result.findings.map((finding) => finding.detail)).toEqual([
      'structure-divergence:docs/docs/intro.md:pl:anchor-only-in-translation:#wylaczanie-modulu',
      'structure-divergence:docs/docs/intro.md:pl:unanchored-h2-count:2-vs-1',
    ]);
  });

  it('reports nothing for a normal translation whose heading text differs', () => {
    expect(run(english, polish).findings).toEqual([]);
  });

  it('reports an anchored section the Polish page keeps and the English page dropped', () => {
    const dropped = english.replace('## One Save on the screen {#one-save}', 'Moved text.');
    const result = run(dropped, polish);
    expect(result.findings.map((finding) => finding.detail)).toEqual([
      'structure-divergence:docs/docs/intro.md:pl:anchor-only-in-translation:#one-save',
    ]);
    expect(result.findings[0]?.kind).toBe('structure-divergence');
  });

  it('reports an anchored section the English page has and the Polish page lacks', () => {
    const result = run(`${english}\n\n## Upgrading {#upgrading}\n`, polish);
    expect(result.findings.map((finding) => finding.detail)).toEqual([
      'structure-divergence:docs/docs/intro.md:pl:anchor-only-in-source:#upgrading',
    ]);
  });

  it('reports an anchor whose heading level differs between the two pages', () => {
    const result = run(english.replace('## One Save', '### One Save'), polish);
    expect(result.findings.map((finding) => finding.detail)).toEqual([
      'structure-divergence:docs/docs/intro.md:pl:anchor-level:#one-save:h3-vs-h2',
    ]);
  });

  it('reports a dropped unanchored section as a per-level heading count mismatch', () => {
    // The #1340 shape: the section had no explicit anchor, so only the count
    // per level can tell the shortened English page from its translation.
    const dropped = english.replace('## Public surface\n\nText.\n\n', '');
    const result = run(dropped, polish);
    expect(result.findings.map((finding) => finding.detail)).toEqual([
      'structure-divergence:docs/docs/intro.md:pl:unanchored-h2-count:0-vs-1',
    ]);
  });

  it('does not compare a translation whose pin is already stale', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', english);
      seedTranslation(root, source, `${polish}\n\n## Dodatkowa {#extra}\n`);
      writeFileSync(source.absolutePath, `${readFileSync(source.absolutePath, 'utf8')}\nMore.\n`);
      const result = checkDocsTranslations(baseInput(root, [source]));
      expect(result.findings.map((finding) => finding.kind)).toEqual(['stale-translation']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
