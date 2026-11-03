import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkDocsTranslations } from '../../../scripts/check-docs-translations.js';
import {
  cacheEntryPath,
  defaultTranslationCacheLayout,
  docIdFromSourcePath,
  hashSourceBody,
  materializedDocPath,
  readCacheEntry,
  writeCacheEntry,
} from '../../../scripts/lib/docs-translation-cache.js';
import type { DocsTranslationSource } from '../../../scripts/lib/docs-translation-sources.js';
import {
  applyDocsTranslationPins,
  planDocsTranslationPins,
  type DocsTranslationPinInput,
} from '../../../scripts/pin-docs-translations.js';

const NOW = '2026-11-03T10:00:00.000Z';
const EARLIER = '2026-09-17T08:00:00.000Z';

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function english(root: string, sourcePath: string, body: string): DocsTranslationSource {
  const absolutePath = join(root, sourcePath);
  writeFile(absolutePath, `---\ntitle: Sample\n---\n\n${body}\n`);
  return { sourcePath, absolutePath };
}

function polish(root: string, source: DocsTranslationSource, body: string, locale = 'pl'): void {
  const layout = defaultTranslationCacheLayout(root);
  writeFile(
    materializedDocPath(locale, docIdFromSourcePath(source.sourcePath), layout),
    `---\ntitle: Próbka\n---\n\n${body}\n`,
  );
}

function pinAt(root: string, source: DocsTranslationSource, hash: string, locale = 'pl'): void {
  writeCacheEntry(
    {
      sourcePath: source.sourcePath,
      sourceHash: hash,
      locale,
      meta: { provider: 'manual', updatedAt: EARLIER },
    },
    defaultTranslationCacheLayout(root),
  );
}

function input(
  root: string,
  sources: readonly DocsTranslationSource[],
  overrides: Partial<DocsTranslationPinInput> = {},
): DocsTranslationPinInput {
  return {
    translateLocales: ['pl'],
    sources,
    skipPaths: new Set(),
    layout: defaultTranslationCacheLayout(root),
    now: () => NOW,
    ...overrides,
  };
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'docs-pin-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('pin-docs-translations (issue #671)', () => {
  it('re-pins a stale page to the current English body, and the check goes green', () => {
    withRoot((root) => {
      const source = english(root, 'docs/docs/intro.md', 'Welcome, edited.');
      polish(root, source, 'Witamy, po zmianie.');
      pinAt(root, source, hashSourceBody('---\ntitle: Sample\n---\n\nWelcome.\n'));

      const checkInput = {
        repoRoot: root,
        defaultLocale: 'en',
        translateLocales: ['pl'],
        sources: [source],
        sidebarMessageIds: [],
        chromeMessages: [],
        inertNamespaces: [],
        skipPaths: new Set<string>(),
        layout: defaultTranslationCacheLayout(root),
        readTranslationFile: () => ({}),
      };
      expect(checkDocsTranslations(checkInput).findings.map((f) => f.kind)).toEqual([
        'stale-translation',
      ]);

      const plan = planDocsTranslationPins(input(root, [source]));
      expect(plan.refused).toEqual([]);
      expect(plan.writes).toEqual([
        {
          sourcePath: 'docs/docs/intro.md',
          sourceHash: hashSourceBody(readFileSync(source.absolutePath, 'utf8')),
          locale: 'pl',
          meta: { provider: 'manual', updatedAt: NOW },
        },
      ]);
      applyDocsTranslationPins(plan, defaultTranslationCacheLayout(root));

      expect(checkDocsTranslations(checkInput).findings).toEqual([]);
    });
  });

  it('pins a translated page that has no pin yet', () => {
    withRoot((root) => {
      const source = english(root, 'docs/docs/new-page.md', 'New.');
      polish(root, source, 'Nowa.');
      const plan = planDocsTranslationPins(input(root, [source]));
      expect(plan.refused).toEqual([]);
      expect(plan.writes.map((entry) => entry.sourcePath)).toEqual(['docs/docs/new-page.md']);
    });
  });

  it('leaves a fresh pin byte-for-byte alone, its date included', () => {
    withRoot((root) => {
      const source = english(root, 'docs/docs/intro.md', 'Welcome.');
      polish(root, source, 'Witamy.');
      pinAt(root, source, hashSourceBody(readFileSync(source.absolutePath, 'utf8')));
      const pinFile = cacheEntryPath('pl', source.sourcePath, defaultTranslationCacheLayout(root));
      const before = readFileSync(pinFile, 'utf8');

      const plan = planDocsTranslationPins(input(root, [source]));
      expect(plan.writes).toEqual([]);
      expect(plan.unchanged).toBe(1);
      applyDocsTranslationPins(plan, defaultTranslationCacheLayout(root));
      expect(readFileSync(pinFile, 'utf8')).toBe(before);
    });
  });

  it('rewrites a pin that still duplicates the page, keeping its hash and date', () => {
    withRoot((root) => {
      const source = english(root, 'docs/docs/intro.md', 'Welcome.');
      polish(root, source, 'Witamy.');
      const hash = hashSourceBody(readFileSync(source.absolutePath, 'utf8'));
      const pinFile = cacheEntryPath('pl', source.sourcePath, defaultTranslationCacheLayout(root));
      writeFile(
        pinFile,
        JSON.stringify({
          sourcePath: source.sourcePath,
          sourceHash: hash,
          locale: 'pl',
          content: 'the whole page',
          meta: { provider: 'manual', updatedAt: EARLIER },
        }),
      );

      const plan = planDocsTranslationPins(input(root, [source]));
      expect(plan.writes).toEqual([
        {
          sourcePath: source.sourcePath,
          sourceHash: hash,
          locale: 'pl',
          meta: { provider: 'manual', updatedAt: EARLIER },
        },
      ]);
    });
  });

  it('refuses to pin a page with no translation, and writes nothing at all', () => {
    withRoot((root) => {
      const translated = english(root, 'docs/docs/a.md', 'A, edited.');
      polish(root, translated, 'A po polsku.');
      pinAt(root, translated, hashSourceBody('---\ntitle: Sample\n---\n\nA.\n'));
      const untranslated = english(root, 'docs/docs/b.md', 'B.');

      const plan = planDocsTranslationPins(input(root, [translated, untranslated]));
      expect(plan.refused.map((refusal) => refusal.detail)).toEqual([
        'no-translation:pl:docs/docs/b.md',
      ]);
      expect(() => applyDocsTranslationPins(plan, defaultTranslationCacheLayout(root))).toThrow(
        /refus/,
      );
      // Atomic: the translated page's stale pin was not rewritten either.
      expect(
        readCacheEntry('pl', translated.sourcePath, defaultTranslationCacheLayout(root))
          ?.sourceHash,
      ).toBe(hashSourceBody('---\ntitle: Sample\n---\n\nA.\n'));
      expect(() =>
        readFileSync(
          cacheEntryPath('pl', untranslated.sourcePath, defaultTranslationCacheLayout(root)),
        ),
      ).toThrow();
    });
  });

  it('refuses to pin a "translation" whose body is the English body copied', () => {
    withRoot((root) => {
      const source = english(root, 'docs/docs/intro.md', 'Welcome.');
      const layout = defaultTranslationCacheLayout(root);
      // Front matter translated, body not: still an untranslated page.
      writeFile(materializedDocPath('pl', 'intro', layout), '---\ntitle: Wstęp\n---\n\nWelcome.\n');
      const plan = planDocsTranslationPins(input(root, [source]));
      expect(plan.refused.map((refusal) => refusal.detail)).toEqual([
        'untranslated-copy:pl:docs/docs/intro.md',
      ]);
      expect(plan.writes).toEqual([]);
    });
  });

  it('pins only the pages it is named, by source key or by English path', () => {
    withRoot((root) => {
      const a = english(root, 'docs/docs/a.md', 'A.');
      const b = english(root, 'docs/docs/b.md', 'B.');
      const referencePath = 'docs/docs/module-reference/catalog.md';
      const reference: DocsTranslationSource = {
        sourcePath: 'generated:module-reference/catalog',
        absolutePath: join(root, referencePath),
      };
      writeFile(reference.absolutePath, '---\ntitle: Catalog\n---\n\nReference.\n');
      for (const source of [a, b, reference]) polish(root, source, 'Przetłumaczone.');
      // `b` is untranslated-in-waiting elsewhere in the tree: naming pages keeps
      // a refusal there from blocking the one the author did translate.
      rmSync(materializedDocPath('pl', 'b', defaultTranslationCacheLayout(root)));

      const plan = planDocsTranslationPins(
        input(root, [a, b, reference], { only: ['docs/docs/a.md', referencePath] }),
      );
      expect(plan.refused).toEqual([]);
      expect(plan.writes.map((entry) => entry.sourcePath).sort()).toEqual([
        'docs/docs/a.md',
        'generated:module-reference/catalog',
      ]);
    });
  });

  it('refuses a named page that is not an English documentation source', () => {
    withRoot((root) => {
      const a = english(root, 'docs/docs/a.md', 'A.');
      polish(root, a, 'A.');
      const plan = planDocsTranslationPins(input(root, [a], { only: ['docs/docs/nope.md'] }));
      expect(plan.refused.map((refusal) => refusal.detail)).toEqual([
        'unknown-source:docs/docs/nope.md',
      ]);
    });
  });

  it('never pins a skipped page', () => {
    withRoot((root) => {
      const skipped = english(root, 'docs/docs/contributing/translations.md', 'Glossary.');
      const plan = planDocsTranslationPins(
        input(root, [skipped], { skipPaths: new Set([skipped.sourcePath]) }),
      );
      expect(plan).toEqual({ writes: [], unchanged: 0, refused: [] });
    });
  });
});
