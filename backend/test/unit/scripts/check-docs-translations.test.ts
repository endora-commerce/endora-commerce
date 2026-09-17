import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
import {
  checkDocsTranslations,
  type DocsTranslationCheckInput,
} from '../../../scripts/check-docs-translations.js';

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

function baseInput(
  root: string,
  sources: readonly DocsTranslationSource[],
  overrides: Partial<DocsTranslationCheckInput> = {},
): DocsTranslationCheckInput {
  return {
    repoRoot: root,
    translateLocales: ['pl'],
    sources,
    sidebarMessageIds: [],
    skipPaths: new Set(),
    layout: layout(root),
    readCodeJson: () => ({}),
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

  it('reports missing-sidebar-message when code.json lacks a sidebar id', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
    try {
      const source = writeEnglish(root, 'docs/docs/intro.md', 'Welcome.');
      const english = readFileSync(source.absolutePath, 'utf8');
      const entry: TranslationCacheEntry = {
        sourcePath: source.sourcePath,
        sourceHash: hashSourceBody(english),
        locale: 'pl',
        content: '---\ntitle: Sample\n---\n\nWitamy.\n',
        meta: { provider: 'manual', updatedAt: '2026-09-17T08:00:00.000Z' },
      };
      writeCacheEntry(entry, layout(root));
      materializeTranslation(entry, layout(root));

      const result = checkDocsTranslations(
        baseInput(root, [source], {
          sidebarMessageIds: ['sidebar.main.doc.intro'],
          readCodeJson: () => ({}),
        }),
      );
      expect(result.findings.some((finding) => finding.kind === 'missing-sidebar-message')).toBe(
        true,
      );
      expect(result.findings.map((finding) => finding.detail)).toContain(
        'missing-sidebar-message:sidebar.main.doc.intro',
      );
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
          readCodeJson: () => ({}),
        }),
      );
      expect(missing.findings.map((finding) => finding.detail)).toContain(
        `missing-sidebar-message:${messageId}`,
      );

      const complete = checkDocsTranslations(
        baseInput(root, [source], {
          sidebarMessageIds: [messageId],
          readCodeJson: () => ({ [messageId]: { message: 'Katalog' } }),
        }),
      );
      expect(complete.findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
