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
  hashSourceBody,
  materializeTranslation,
  materializedDocPath,
  writeCacheEntry,
  type TranslationCacheEntry,
} from '../../../scripts/lib/docs-translation-cache.js';
import {
  sidebarMessageIdsIn,
  type DocsTranslationSource,
} from '../../../scripts/lib/docs-translation-sources.js';
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
    content: `---\ntitle: Sample\n---\n\n${polishBody}\n`,
    meta: { provider: 'manual', updatedAt: '2026-09-17T08:00:00.000Z' },
  };
  writeCacheEntry(entry, layout(root));
  materializeTranslation(entry, layout(root));
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
    content: polish,
    meta: { provider: 'manual', updatedAt: '2026-09-17T08:00:00.000Z' },
  };
  writeCacheEntry(entry, layout(root));
  materializeTranslation(entry, layout(root));
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
        content: '---\ntitle: Sample\n---\n\nWitamy.\n',
        meta: { provider: 'manual', updatedAt: '2026-09-17T08:00:00.000Z' },
      };
      writeCacheEntry(entry, layout(root));
      materializeTranslation(entry, layout(root));

      const result = checkDocsTranslations(baseInput(root, [source]));
      expect(result.findings.map((finding) => finding.kind)).toEqual(['stale-translation']);
      expect(result.findings[0]?.detail).toBe('stale-translation:docs/docs/intro.md');
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
});
