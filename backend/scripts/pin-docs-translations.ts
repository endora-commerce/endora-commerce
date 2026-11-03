/**
 * Re-pin documentation translations to the current English bodies (issue #671).
 *
 * A pin (`docs/translation-cache/<locale>/<key>.json`) records which English body
 * a translation was made from; `check:docs-translations` reports
 * `stale-translation` when the English body has moved since. Running this after
 * translating — or after resolving a merge conflict in a pin, by taking either
 * side and re-running it — recomputes the hash instead of hand-editing it.
 *
 * Pinning is the author's claim that the translation is up to date with the
 * English body; the command can only refuse the claims it can disprove:
 *
 * - `no-translation` — there is no materialised page for the locale at all;
 * - `untranslated-copy` — the materialised page's body is the English body;
 * - `unknown-source` — a named page is not an English documentation source.
 *
 * Any refusal writes nothing, so a run is all or nothing. Name pages to pin only
 * those (by source key, e.g. `generated:module-reference/catalog`, or by the
 * English file's repo-relative path); with no names every source is considered.
 * A fresh, well-formed pin is never rewritten, so its date stays as it was; a
 * well-formed-but-legacy entry is rewritten to the pin shape with its hash kept.
 *
 * Usage: `pnpm --filter backend run docs:translations:pin [<page>...]`
 *
 * Exit 0 = pins written (or none needed); exit 2 = refused, or nothing to read.
 */
/* eslint-disable no-console -- CLI: stdout/stderr is the interface. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadDocsLocales } from './lib/docs-locales.js';
import {
  cacheEntryPath,
  defaultTranslationCacheLayout,
  docIdFromSourcePath,
  hashSourceBody,
  materializedDocPath,
  readCacheEntryResult,
  serializeCacheEntry,
  type TranslationCacheEntry,
  type TranslationCacheLayout,
} from './lib/docs-translation-cache.js';
import {
  collectAllDocsTranslationSources,
  loadTranslationSkipPaths,
  type DocsTranslationSource,
} from './lib/docs-translation-sources.js';

const PREFIX = '[docs-translations:pin]';

export type DocsTranslationPinRefusalReason =
  'no-translation' | 'untranslated-copy' | 'unknown-source';

export interface DocsTranslationPinRefusal {
  readonly reason: DocsTranslationPinRefusalReason;
  readonly detail: string;
}

export interface DocsTranslationPinInput {
  readonly translateLocales: readonly string[];
  readonly sources: readonly DocsTranslationSource[];
  readonly skipPaths: ReadonlySet<string>;
  readonly layout: TranslationCacheLayout;
  /** Pages to pin, by source key or English repo-relative path; all when absent. */
  readonly only?: readonly string[];
  readonly now: () => string;
  readonly readSource?: (absolutePath: string) => string;
}

export interface DocsTranslationPinPlan {
  readonly writes: readonly TranslationCacheEntry[];
  readonly unchanged: number;
  readonly refused: readonly DocsTranslationPinRefusal[];
}

function repoRelative(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split('\\').join('/');
}

/** Pure planning over the handed-in population (unit tests enter here). */
export function planDocsTranslationPins(input: DocsTranslationPinInput): DocsTranslationPinPlan {
  const readSource = input.readSource ?? ((path: string) => readFileSync(path, 'utf8'));
  const refused: DocsTranslationPinRefusal[] = [];
  const writes: TranslationCacheEntry[] = [];
  let unchanged = 0;

  const active = input.sources.filter((source) => !input.skipPaths.has(source.sourcePath));
  let targets = active;
  if (input.only !== undefined) {
    const named = new Set(input.only);
    const matched = new Set<string>();
    targets = active.filter((source) => {
      const englishPath = repoRelative(input.layout.repoRoot, source.absolutePath);
      const hit = [source.sourcePath, englishPath].filter((name) => named.has(name));
      for (const name of hit) matched.add(name);
      return hit.length > 0;
    });
    for (const name of input.only) {
      if (!matched.has(name)) {
        refused.push({ reason: 'unknown-source', detail: `unknown-source:${name}` });
      }
    }
  }

  for (const locale of input.translateLocales) {
    for (const source of targets) {
      const english = readSource(source.absolutePath);
      const currentHash = hashSourceBody(english);
      const page = materializedDocPath(
        locale,
        docIdFromSourcePath(source.sourcePath),
        input.layout,
      );
      if (!existsSync(page)) {
        refused.push({
          reason: 'no-translation',
          detail: `no-translation:${locale}:${source.sourcePath}`,
        });
        continue;
      }
      if (hashSourceBody(readFileSync(page, 'utf8')) === currentHash) {
        refused.push({
          reason: 'untranslated-copy',
          detail: `untranslated-copy:${locale}:${source.sourcePath}`,
        });
        continue;
      }

      const existing = readCacheEntryResult(locale, source.sourcePath, input.layout);
      if (existing.kind === 'pin' && existing.entry.sourceHash === currentHash) {
        unchanged += 1;
        continue;
      }
      const legacy =
        existing.kind === 'malformed' ? legacyPinOf(locale, source, input.layout) : null;
      const keepDate = legacy !== null && legacy.sourceHash === currentHash;
      writes.push({
        sourcePath: source.sourcePath,
        sourceHash: currentHash,
        locale,
        meta: { provider: 'manual', updatedAt: keepDate ? legacy.updatedAt : input.now() },
      });
    }
  }

  return { writes, unchanged, refused };
}

/**
 * The hash and date of a malformed entry that is otherwise a pin — the pre-#671
 * shape with `content` beside them — so that normalising one keeps its date.
 */
function legacyPinOf(
  locale: string,
  source: DocsTranslationSource,
  layout: TranslationCacheLayout,
): { sourceHash: string; updatedAt: string } | null {
  try {
    const value = JSON.parse(
      readFileSync(cacheEntryPath(locale, source.sourcePath, layout), 'utf8'),
    ) as {
      sourceHash?: unknown;
      meta?: { updatedAt?: unknown };
    };
    if (typeof value.sourceHash === 'string' && typeof value.meta?.updatedAt === 'string') {
      return { sourceHash: value.sourceHash, updatedAt: value.meta.updatedAt };
    }
  } catch {
    // Unparseable (an unresolved conflict, say): nothing to keep.
  }
  return null;
}

/** Write a plan; refuses — writing nothing — when the plan refused anything. */
export function applyDocsTranslationPins(
  plan: DocsTranslationPinPlan,
  layout: TranslationCacheLayout,
): void {
  if (plan.refused.length > 0) {
    throw new Error(
      `${PREFIX} refusing to pin: ${plan.refused.map((refusal) => refusal.detail).join(', ')}`,
    );
  }
  for (const entry of plan.writes) {
    const path = cacheEntryPath(entry.locale, entry.sourcePath, layout);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeCacheEntry(entry), 'utf8');
  }
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const locales = loadDocsLocales();
  const { resolveDocsTranslationLayout } = await import('./lib/docs-translation-sources.js');
  const layoutContext = await resolveDocsTranslationLayout();
  const layout = defaultTranslationCacheLayout(layoutContext.repoRoot);
  const sources = collectAllDocsTranslationSources(
    layoutContext.repoRoot,
    layoutContext.contentRoot,
    layoutContext.modulesRoot,
    layoutContext.modulePages,
  );
  if (sources.length === 0) {
    console.error(`${PREFIX} no English documentation sources found — refusing to pin nothing.`);
    process.exit(2);
  }

  const plan = planDocsTranslationPins({
    translateLocales: locales.translateLocales,
    sources,
    skipPaths: loadTranslationSkipPaths(layoutContext.repoRoot),
    layout,
    ...(only.length > 0 ? { only } : {}),
    now: () => new Date().toISOString(),
  });

  if (plan.refused.length > 0) {
    console.error(`${PREFIX} refused — nothing was written:`);
    for (const refusal of plan.refused) {
      console.error(`  - ${refusal.detail}`);
    }
    console.error(
      `${PREFIX} translate the page under docs/i18n/<locale>/ first, or name only the pages ` +
        'you translated.',
    );
    process.exit(2);
  }

  applyDocsTranslationPins(plan, layout);
  for (const entry of plan.writes) {
    console.log(`  pinned ${entry.locale}:${entry.sourcePath}`);
  }
  console.log(`${PREFIX} pinned=${plan.writes.length} unchanged=${plan.unchanged}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
