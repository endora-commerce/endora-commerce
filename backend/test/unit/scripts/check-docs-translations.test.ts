import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashSourceBody } from '../../../scripts/lib/docs-markdown-segments.js';
import {
  defaultTranslationCacheLayout,
  materializeTranslation,
  writeCacheEntry,
  type TranslationCacheEntry,
} from '../../../scripts/lib/docs-translation-cache.js';
import type { DocsTranslationSource } from '../../../scripts/lib/docs-translation-sources.js';
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
        meta: { provider: 'deepl', translatedAt: '2026-09-17T08:00:00.000Z' },
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
        meta: { provider: 'deepl', translatedAt: '2026-09-17T08:00:00.000Z' },
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
});
