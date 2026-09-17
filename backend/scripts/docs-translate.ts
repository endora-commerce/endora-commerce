/**
 * Maintainer-only machine translation for the documentation site (feature 132).
 *
 * Walks layer-1 hand-authored pages and layer-4 module-owned docs, calls DeepL,
 * writes pinned cache entries and materializes `docs/i18n/<locale>/…` markdown.
 *
 * Usage:
 *   pnpm --filter backend run docs:translate
 *   pnpm --filter backend run docs:translate -- --since origin/master
 *   pnpm --filter backend run docs:translate -- --check
 *   pnpm --filter backend run docs:translate -- --locale pl
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { pathToFileURL } from 'node:url';

import { createDeepLTranslator } from './lib/docs-deepl-client.js';
import { loadDocsLocales } from './lib/docs-locales.js';
import { translateDocument } from './lib/docs-translate-core.js';
import { defaultTranslationCacheLayout } from './lib/docs-translation-cache.js';
import { reportReadSize } from './lib/read-size.js';
import {
  collectTranslateCommandSources,
  resolveDocsTranslationLayout,
  sourcesChangedSince,
} from './lib/docs-translation-sources.js';

const PREFIX = '[docs-translate]';

function parseArgs(argv: readonly string[]): {
  readonly checkOnly: boolean;
  readonly sinceRef: string | null;
  readonly localeFilter: string | null;
} {
  const checkOnly = argv.includes('--check');
  const sinceIndex = argv.indexOf('--since');
  const sinceRef = sinceIndex === -1 ? null : (argv[sinceIndex + 1] ?? null);
  if (sinceIndex !== -1 && (sinceRef === null || sinceRef.startsWith('--'))) {
    throw new Error(`${PREFIX} --since requires a git ref.`);
  }
  const localeIndex = argv.indexOf('--locale');
  const localeFilter = localeIndex === -1 ? null : (argv[localeIndex + 1] ?? null);
  if (localeIndex !== -1 && (localeFilter === null || localeFilter.startsWith('--'))) {
    throw new Error(`${PREFIX} --locale requires a locale code.`);
  }
  return { checkOnly, sinceRef, localeFilter };
}

async function main(): Promise<void> {
  const { checkOnly, sinceRef, localeFilter } = parseArgs(process.argv.slice(2));
  const locales = loadDocsLocales();
  const targetLocales =
    localeFilter === null
      ? [...locales.translateLocales]
      : locales.translateLocales.filter((locale) => locale === localeFilter);
  if (targetLocales.length === 0) {
    console.error(`${PREFIX} no translate locale matched --locale ${localeFilter ?? ''}.`.trim());
    process.exit(2);
  }

  const layoutContext = await resolveDocsTranslationLayout();
  let sources = collectTranslateCommandSources(
    layoutContext.repoRoot,
    layoutContext.contentRoot,
    layoutContext.modulePages,
  );
  sources = sources.filter((source) => !layoutContext.skipPaths.has(source.sourcePath));
  if (sinceRef !== null) {
    sources = sourcesChangedSince(sources, sinceRef, layoutContext.repoRoot);
  }

  const layout = defaultTranslationCacheLayout(layoutContext.repoRoot);
  const translator = checkOnly ? null : await createDeepLTranslator();
  let wouldTranslate = 0;
  let translated = 0;
  let fresh = 0;

  for (const locale of targetLocales) {
    for (const source of sources) {
      const result = await translateDocument({
        source,
        locale,
        layout,
        translator:
          translator ??
          ({
            translateTexts: async () => {
              throw new Error('translator unavailable in --check mode');
            },
          } as never),
        dryRun: checkOnly,
      });
      if (result.status === 'would-translate') {
        wouldTranslate += 1;
        console.log(`${PREFIX} would-translate ${locale}:${source.sourcePath}`);
      } else if (result.status === 'translated') {
        translated += 1;
        console.log(`${PREFIX} translated ${locale}:${source.sourcePath}`);
      } else if (result.status === 'fresh') {
        fresh += 1;
      }
    }
  }

  reportReadSize({
    prefix: PREFIX,
    files: sources.length,
    sites: sources.length * targetLocales.length,
    coverage: [],
  });
  console.log(
    `${PREFIX} locales=${targetLocales.length} sources=${sources.length} fresh=${fresh} translated=${translated} would-translate=${wouldTranslate}`,
  );
  if (checkOnly && wouldTranslate > 0) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
