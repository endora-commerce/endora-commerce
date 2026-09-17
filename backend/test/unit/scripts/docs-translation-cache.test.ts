import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  hashSourceBody,
  cacheEntryPath,
  docIdFromSourcePath,
  isCacheHit,
  materializeTranslation,
  materializedDocPath,
  readCacheEntry,
  sourceKeyOf,
  writeCacheEntry,
  type TranslationCacheEntry,
  type TranslationCacheLayout,
} from '../../../scripts/lib/docs-translation-cache.js';

function layout(root: string): TranslationCacheLayout {
  return {
    repoRoot: root,
    cacheRoot: join(root, 'docs/translation-cache'),
    i18nDocsRoot: (locale: string) =>
      join(root, 'docs/i18n', locale, 'docusaurus-plugin-content-docs/current'),
  };
}

function sampleEntry(overrides: Partial<TranslationCacheEntry> = {}): TranslationCacheEntry {
  return {
    sourcePath: 'docs/docs/intro.md',
    sourceHash: hashSourceBody('---\ntitle: Intro\n---\n\nWelcome.\n'),
    locale: 'pl',
    content: '---\ntitle: Wstęp\n---\n\nWitamy.\n',
    meta: {
      provider: 'manual',
      updatedAt: '2026-09-17T08:00:00.000Z',
    },
    ...overrides,
  };
}

describe('docs-translation-cache', () => {
  it('derives stable source keys and doc ids', () => {
    expect(sourceKeyOf('docs/docs/architecture/kernel.md')).toBe(
      'docs--docs--architecture--kernel.md',
    );
    expect(docIdFromSourcePath('docs/docs/architecture/kernel.md')).toBe('architecture/kernel');
    expect(docIdFromSourcePath('packages/modules/catalog/docs/catalog.md')).toBe('modules/catalog');
    expect(docIdFromSourcePath('generated:module-reference/catalog')).toBe(
      'module-reference/catalog',
    );
  });

  it('maps materialized paths to the Docusaurus i18n layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-cache-'));
    try {
      const paths = layout(root);
      expect(materializedDocPath('pl', 'architecture/kernel', paths)).toBe(
        join(root, 'docs/i18n/pl/docusaurus-plugin-content-docs/current/architecture/kernel.md'),
      );
      expect(cacheEntryPath('pl', 'docs/docs/intro.md', paths)).toBe(
        join(root, 'docs/translation-cache/pl/docs--docs--intro.md.json'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes and reads cache entries under locale directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-cache-'));
    try {
      const paths = layout(root);
      const entry = sampleEntry();
      writeCacheEntry(entry, paths);
      expect(readCacheEntry('pl', entry.sourcePath, paths)).toEqual(entry);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hashes only the normalised body with front matter stripped', () => {
    const source = '---\ntitle: Command Bus\n---\n\nBody text.\n';
    const withEditedTitle = source.replace('title: Command Bus', 'title: Different title');
    expect(hashSourceBody(source)).toBe(hashSourceBody(withEditedTitle));
    expect(hashSourceBody(source)).not.toBe(hashSourceBody(`${source}\nMore text.`));
  });

  it('detects cache hits only when the source hash matches', () => {
    const english = '---\ntitle: Intro\n---\n\nWelcome.\n';
    const entry = sampleEntry({ sourceHash: hashSourceBody(english) });
    expect(isCacheHit(entry, english)).toBe(true);
    expect(isCacheHit(entry, `${english}\nMore text.`)).toBe(false);
    expect(isCacheHit(null, english)).toBe(false);
  });

  it('materializes translated markdown to the i18n docs tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-cache-'));
    try {
      const paths = layout(root);
      const entry = sampleEntry();
      const target = materializeTranslation(entry, paths);
      expect(target).toBe(materializedDocPath('pl', 'intro', paths));
      expect(readFileSync(target, 'utf8')).toBe(entry.content);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
