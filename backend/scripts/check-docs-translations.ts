/**
 * FR-022 — every English documentation source has a pinned translation cache entry
 * at the current source hash and a materialized i18n markdown file for each configured
 * translate locale.
 *
 * Feature 133 (FR-043) added the half that reports on **what Docusaurus actually
 * reads**. Until then this check asked whether a message id *existed in
 * `code.json`*, and answered green while the entire Polish chrome rendered in
 * English: the ids were correctly named and in a file the generator never
 * opens. So `missing-sidebar-message` now reads
 * `docs/i18n/<locale>/docusaurus-plugin-content-docs/current.json`, and three
 * findings join it — `chrome-message-missing`, `chrome-message-inert` and
 * `doc-title-unresolvable`. The expected id set is derived from
 * `docs/docusaurus.config.js` and `docs/sidebars.js` by
 * `lib/docs-chrome-messages.ts`, never listed here.
 *
 * Usage: `pnpm --filter backend run check:docs-translations`
 *
 * Exit 0 = complete; exit 2 = missing or stale translations, chrome messages in
 * the wrong file or missing from the right one, or a page with no reachable title.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CODE_JSON_FILE,
  CONTENT_DOCS_CURRENT_FILE,
  chromeMessagesFor,
  docsChromeConfigPaths,
  loadDocsChromeConfig,
  requiredSidebarMessageIds,
  sidebarNamespacePrefixes,
  type ChromeMessage,
} from './lib/docs-chrome-messages.js';
import { loadDocsLocales } from './lib/docs-locales.js';
import { resolveDocTitle } from './lib/docs-title-resolution.js';
import {
  cacheEntryPath,
  defaultTranslationCacheLayout,
  docIdFromSourcePath,
  hashSourceBody,
  readCacheEntry,
  materializedDocPath,
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
  | 'missing-sidebar-message'
  | 'chrome-message-missing'
  | 'chrome-message-inert'
  | 'doc-title-unresolvable';

export interface DocsTranslationFinding {
  readonly kind: DocsTranslationFindingKind;
  readonly key: string;
  readonly detail: string;
}

export interface DocsTranslationCheckInput {
  readonly repoRoot: string;
  /** The locale the English sources themselves are in — title checks key on it. */
  readonly defaultLocale: string;
  readonly translateLocales: readonly string[];
  readonly sources: readonly DocsTranslationSource[];
  /** Sidebar ids each locale must carry in `current.json` (categories and links). */
  readonly sidebarMessageIds: readonly string[];
  /** Config-derived chrome ids and the file Docusaurus reads each from. */
  readonly chromeMessages: readonly ChromeMessage[];
  /** `code.json` key prefixes owned by a theme or plugin translation file. */
  readonly inertNamespaces: readonly string[];
  readonly skipPaths: ReadonlySet<string>;
  readonly layout: TranslationCacheLayout;
  readonly readSource?: (absolutePath: string) => string;
  /** Read `docs/i18n/<locale>/<file>`; `null` when the file does not exist. */
  readonly readTranslationFile?: (
    locale: string,
    file: string,
  ) => Record<string, unknown> | null;
}

export interface DocsTranslationCheckResult {
  readonly findings: readonly DocsTranslationFinding[];
  readonly files: number;
  readonly sites: number;
}

function translationFilePath(
  locale: string,
  file: string,
  layout: TranslationCacheLayout,
): string {
  return join(layout.repoRoot, 'docs/i18n', locale, file);
}

function readTranslationFileFrom(
  locale: string,
  file: string,
  layout: TranslationCacheLayout,
): Record<string, unknown> | null {
  const path = translationFilePath(locale, file, layout);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function repoRelative(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split('\\').join('/');
}

/** Pure check over the handed-in population (unit tests enter here). */
export function checkDocsTranslations(input: DocsTranslationCheckInput): DocsTranslationCheckResult {
  const readSource = input.readSource ?? ((path: string) => readFileSync(path, 'utf8'));
  const readTranslationFile =
    input.readTranslationFile ??
    ((locale: string, file: string) => readTranslationFileFrom(locale, file, input.layout));
  const findings: DocsTranslationFinding[] = [];
  const opened = new Set<string>();

  const activeSources = input.sources.filter((source) => !input.skipPaths.has(source.sourcePath));
  // One defect, one finding: an id `missing-sidebar-message` already owns is not
  // reported a second time as `chrome-message-missing`.
  const ownedBySidebarFinding = new Set(input.sidebarMessageIds);

  for (const source of activeSources) {
    const english = readSource(source.absolutePath);
    const title = resolveDocTitle(english);
    if (!title.resolvable) {
      const path = repoRelative(input.repoRoot, source.absolutePath);
      findings.push({
        kind: 'doc-title-unresolvable',
        key: `${input.defaultLocale}:${source.sourcePath}:title`,
        detail: `doc-title-unresolvable:${path}:${title.reason}`,
      });
    }
  }

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
        continue;
      }
      // The same rule as the English source above, evaluated on the artefact
      // this locale actually ships: a Polish page whose first content node is a
      // translation-policy admonition resolves no title of its own.
      const translatedTitle = resolveDocTitle(onDisk);
      if (!translatedTitle.resolvable) {
        findings.push({
          kind: 'doc-title-unresolvable',
          key: `${locale}:${source.sourcePath}:title`,
          detail:
            `doc-title-unresolvable:${repoRelative(input.repoRoot, materialized)}:` +
            translatedTitle.reason,
        });
      }
    }

    opened.add(translationFilePath(locale, CONTENT_DOCS_CURRENT_FILE, input.layout));
    opened.add(translationFilePath(locale, CODE_JSON_FILE, input.layout));

    const currentJson = readTranslationFile(locale, CONTENT_DOCS_CURRENT_FILE);
    for (const messageId of input.sidebarMessageIds) {
      if (currentJson === null || !(messageId in currentJson)) {
        findings.push({
          kind: 'missing-sidebar-message',
          key: `${locale}:${messageId}`,
          detail: `missing-sidebar-message:${locale}/${CONTENT_DOCS_CURRENT_FILE}:${messageId}`,
        });
      }
    }

    const byFile = new Map<string, Record<string, unknown> | null>([
      [CONTENT_DOCS_CURRENT_FILE, currentJson],
    ]);
    for (const message of input.chromeMessages) {
      opened.add(translationFilePath(locale, message.file, input.layout));
      if (!byFile.has(message.file)) {
        byFile.set(message.file, readTranslationFile(locale, message.file));
      }
      if (ownedBySidebarFinding.has(message.id)) {
        continue;
      }
      const content = byFile.get(message.file) ?? null;
      if (content === null || !(message.id in content)) {
        findings.push({
          kind: 'chrome-message-missing',
          key: `${locale}:${message.file}:${message.id}`,
          detail: `chrome-message-missing:${locale}/${message.file}:${message.id}`,
        });
      }
    }

    const codeJson = readTranslationFile(locale, CODE_JSON_FILE);
    if (codeJson !== null) {
      const inert = new Set<string>();
      for (const message of input.chromeMessages) {
        for (const key of message.codeJsonKeys) {
          if (key in codeJson) {
            inert.add(key);
          }
        }
      }
      for (const key of Object.keys(codeJson)) {
        if (input.inertNamespaces.some((prefix) => key.startsWith(prefix))) {
          inert.add(key);
        }
      }
      for (const key of [...inert].sort()) {
        findings.push({
          kind: 'chrome-message-inert',
          key: `${locale}:${CODE_JSON_FILE}:${key}`,
          detail: `chrome-message-inert:${locale}/${CODE_JSON_FILE}:${key}`,
        });
      }
    }
  }

  return {
    findings: findings.sort((a, b) => a.key.localeCompare(b.key)),
    files: opened.size,
    sites:
      activeSources.length * input.translateLocales.length +
      input.sidebarMessageIds.length +
      input.chromeMessages.length,
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
  const sidebarMessageIds = requiredSidebarMessageIds(
    collectSidebarMessageIds(layoutContext.repoRoot, layoutContext.docsMemberDir),
  );
  const chromeConfig = loadDocsChromeConfig(layoutContext.docsMemberDir);
  const chromeMessages = chromeMessagesFor(chromeConfig);
  const inertNamespaces = sidebarNamespacePrefixes(chromeConfig.sidebars);
  const skipPaths = loadTranslationSkipPaths(layoutContext.repoRoot);

  if (sources.length === 0) {
    console.error(`${PREFIX} no English documentation sources found — refusing a vacuous pass.`);
    process.exit(2);
  }
  if (chromeMessages.length === 0) {
    console.error(
      `${PREFIX} no chrome message ids derived from the site config — refusing a vacuous pass.`,
    );
    process.exit(2);
  }

  const result = checkDocsTranslations({
    repoRoot: layoutContext.repoRoot,
    defaultLocale: locales.defaultLocale,
    translateLocales: locales.translateLocales,
    sources,
    sidebarMessageIds,
    chromeMessages,
    inertNamespaces,
    skipPaths,
    layout,
  });

  reportReadSize({
    prefix: PREFIX,
    files: result.files + docsChromeConfigPaths(layoutContext.docsMemberDir).length,
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
