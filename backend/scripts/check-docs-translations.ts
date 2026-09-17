/**
 * FR-022 — every English documentation source has a pinned translation cache entry
 * at the current source hash and a materialized i18n markdown file for each configured
 * translate locale; sidebar message ids exist in `docs/i18n/<locale>/code.json`.
 *
 * Usage: `pnpm --filter backend run check:docs-translations`
 *
 * Exit 0 = complete; exit 2 = missing or stale translations / sidebar messages.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadDocsLocales } from './lib/docs-locales.js';
import {
  cacheEntryPath,
  defaultTranslationCacheLayout,
  docIdFromSourcePath,
  hashSourceBody,
  materializedDocPath,
  readCacheEntry,
  type TranslationCacheLayout,
} from './lib/docs-translation-cache.js';
import {
  collectAllDocsTranslationSources,
  collectSidebarMessageIds,
  loadTranslationSkipPaths,
  type DocsTranslationSource,
} from './lib/docs-translation-sources.js';
import { reportReadSize } from './lib/read-size.js';

const PREFIX = '[docs-translations]';

export type DocsTranslationFindingKind =
  | 'missing-translation'
  | 'stale-translation'
  | 'missing-sidebar-message';

export interface DocsTranslationFinding {
  readonly kind: DocsTranslationFindingKind;
  readonly key: string;
  readonly detail: string;
}

export interface DocsTranslationCheckInput {
  readonly repoRoot: string;
  readonly translateLocales: readonly string[];
  readonly sources: readonly DocsTranslationSource[];
  readonly sidebarMessageIds: readonly string[];
  readonly skipPaths: ReadonlySet<string>;
  readonly layout: TranslationCacheLayout;
  readonly readSource?: (absolutePath: string) => string;
  readonly readCodeJson?: (locale: string) => Record<string, unknown> | null;
}

export interface DocsTranslationCheckResult {
  readonly findings: readonly DocsTranslationFinding[];
  readonly files: number;
  readonly sites: number;
}

function readCodeJsonFile(locale: string, layout: TranslationCacheLayout): Record<string, unknown> | null {
  const path = join(layout.repoRoot, 'docs/i18n', locale, 'code.json');
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** Pure check over the handed-in population (unit tests enter here). */
export function checkDocsTranslations(input: DocsTranslationCheckInput): DocsTranslationCheckResult {
  const readSource = input.readSource ?? ((path: string) => readFileSync(path, 'utf8'));
  const readCodeJson = input.readCodeJson ?? ((locale) => readCodeJsonFile(locale, input.layout));
  const findings: DocsTranslationFinding[] = [];
  const opened = new Set<string>();

  const activeSources = input.sources.filter((source) => !input.skipPaths.has(source.sourcePath));

  for (const locale of input.translateLocales) {
    for (const source of activeSources) {
      opened.add(source.absolutePath);
      opened.add(cacheEntryPath(locale, source.sourcePath, input.layout));
      opened.add(materializedDocPath(locale, docIdFromSourcePath(source.sourcePath), input.layout));

      const english = readSource(source.absolutePath);
      const currentHash = hashSourceBody(english);
      const entry = readCacheEntry(locale, source.sourcePath, input.layout);
      if (entry === null) {
        findings.push({
          kind: 'missing-translation',
          key: `${locale}:${source.sourcePath}`,
          detail: `missing-translation:${source.sourcePath}`,
        });
        continue;
      }
      if (entry.sourceHash !== currentHash) {
        findings.push({
          kind: 'stale-translation',
          key: `${locale}:${source.sourcePath}`,
          detail: `stale-translation:${source.sourcePath}`,
        });
        continue;
      }
      const materialized = materializedDocPath(
        locale,
        docIdFromSourcePath(source.sourcePath),
        input.layout,
      );
      if (!existsSync(materialized)) {
        findings.push({
          kind: 'missing-translation',
          key: `${locale}:${source.sourcePath}`,
          detail: `missing-translation:${source.sourcePath}`,
        });
        continue;
      }
      const onDisk = readFileSync(materialized, 'utf8');
      if (onDisk !== entry.content) {
        findings.push({
          kind: 'stale-translation',
          key: `${locale}:${source.sourcePath}`,
          detail: `stale-translation:${source.sourcePath}`,
        });
      }
    }

    const codeJson = readCodeJson(locale);
    for (const messageId of input.sidebarMessageIds) {
      if (codeJson === null || !(messageId in codeJson)) {
        findings.push({
          kind: 'missing-sidebar-message',
          key: `${locale}:${messageId}`,
          detail: `missing-sidebar-message:${messageId}`,
        });
      }
    }
  }

  return {
    findings: findings.sort((a, b) => a.key.localeCompare(b.key)),
    files: opened.size,
    sites: activeSources.length * input.translateLocales.length + input.sidebarMessageIds.length,
  };
}

async function main(): Promise<void> {
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
  const sidebarMessageIds = collectSidebarMessageIds(
    layoutContext.repoRoot,
    layoutContext.docsMemberDir,
  );
  const skipPaths = loadTranslationSkipPaths(layoutContext.repoRoot);

  if (sources.length === 0) {
    console.error(`${PREFIX} no English documentation sources found — refusing a vacuous pass.`);
    process.exit(2);
  }

  const result = checkDocsTranslations({
    repoRoot: layoutContext.repoRoot,
    translateLocales: locales.translateLocales,
    sources,
    sidebarMessageIds,
    skipPaths,
    layout,
  });

  reportReadSize({
    prefix: PREFIX,
    files: result.files,
    sites: result.sites,
    coverage: [],
  });
  console.log(`${PREFIX} sources=${sources.length} findings=${result.findings.length}`);

  if (result.findings.length === 0) {
    process.exit(0);
  }

  for (const finding of result.findings) {
    console.error(`  - ${finding.detail}`);
  }
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
