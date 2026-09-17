import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import type { DocsRegistry } from './docs-artefacts.js';
import type { DocsTextTranslator } from './docs-deepl-client.js';
import {
  labelOf,
  MODULE_MAP_ARTEFACT,
  MODULE_REFERENCE_CATEGORY,
  MODULES_CATEGORY,
} from './module-docs.js';
import {
  materializeGeneratedDocTranslation,
  type MaterializeGeneratedDocTranslationOptions,
} from './docs-translate-core.js';
import {
  docIdFromSourcePath,
  isCacheHit,
  materializedDocPath,
  readCacheEntry,
  type TranslationCacheLayout,
} from './docs-translation-cache.js';
import {
  materializeSidebarMessage,
  resolveSidebarEnglishMessages,
  verifySidebarMessageCache,
  type SidebarMessage,
} from './docs-sidebar-i18n.js';

/** One rendered documentation artefact from `renderAll()`. */
export interface ComposerDocsArtefact {
  readonly label: string;
  readonly outputPath: string;
  readonly content: string;
}

/** Cache key for a generated module reference page. */
export function generatedReferenceSourcePath(slug: string): string {
  return `generated:module-reference/${slug}`;
}

/** Derive the reference slug from a committed output path. */
export function referenceSlugFromOutputPath(
  outputPath: string,
  contentRoot: string,
): string | null {
  const prefix = `${join(contentRoot, MODULE_REFERENCE_CATEGORY)}/`;
  if (!outputPath.startsWith(prefix) || !outputPath.endsWith('.md')) {
    return null;
  }
  return basename(outputPath, '.md');
}

/** Repo-relative cache key for the generated module map page. */
export function moduleMapSourcePath(repoRoot: string, outputPath: string): string {
  return relative(repoRoot, outputPath).split('\\').join('/');
}

/** English sidebar labels keyed by doc id or module id. */
export function buildDocLabelMap(registry: DocsRegistry): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();

  for (const page of registry.pages) {
    labels.set(page.docId, labelOf(page, page.docId));
  }

  for (const entry of registry.entries) {
    const fallback = entry.moduleId;
    if (entry.docs !== null) {
      labels.set(entry.docs.entry.docId, labelOf(entry.docs.entry, fallback));
      labels.set(entry.moduleId, labelOf(entry.docs.entry, fallback));
      for (const child of entry.docs.children) {
        labels.set(child.docId, labelOf(child, child.docId));
      }
    } else if (entry.referenceDocId !== null) {
      labels.set(entry.moduleId, fallback);
      labels.set(entry.referenceDocId, fallback);
    }
  }

  labels.set(
    `${MODULES_CATEGORY}/${MODULE_MAP_ARTEFACT.replace(/\.mdx?$/, '')}`,
    'Module map',
  );
  labels.set('module-map', 'Module map');

  return labels;
}

export type GeneratedTranslationCacheVerdict = 'ok' | 'missing' | 'stale';

/** Verify one generated markdown translation cache entry and materialized file. */
export function verifyGeneratedDocTranslationCache(
  englishContent: string,
  sourcePath: string,
  locale: string,
  layout: TranslationCacheLayout,
): GeneratedTranslationCacheVerdict {
  const entry = readCacheEntry(locale, sourcePath, layout);
  if (entry === null) {
    return 'missing';
  }
  if (!isCacheHit(entry, englishContent)) {
    return 'stale';
  }
  const materialized = materializedDocPath(locale, docIdFromSourcePath(sourcePath), layout);
  if (!existsSync(materialized)) {
    return 'missing';
  }
  if (readFileSync(materialized, 'utf8') !== entry.content) {
    return 'stale';
  }
  return 'ok';
}

export interface ComposerI18nMaterializeOptions {
  readonly artefacts: readonly ComposerDocsArtefact[];
  readonly registry: DocsRegistry;
  readonly translateLocales: readonly string[];
  readonly layout: TranslationCacheLayout;
  readonly translator: DocsTextTranslator;
  readonly dryRun?: boolean;
}

export interface ComposerI18nMaterializeSummary {
  readonly translated: number;
  readonly fresh: number;
  readonly wouldTranslate: number;
}

/** Materialize Polish for generated reference pages, module map, and sidebar labels. */
export async function materializeComposerGeneratedTranslations(
  options: ComposerI18nMaterializeOptions,
): Promise<ComposerI18nMaterializeSummary> {
  const summary: ComposerI18nMaterializeSummary = {
    translated: 0,
    fresh: 0,
    wouldTranslate: 0,
  };
  const docLabels = buildDocLabelMap(options.registry);
  const sidebar = options.artefacts.find((artefact) => artefact.label === 'docs-sidebar');
  const sidebarMessages =
    sidebar === undefined ? [] : resolveSidebarEnglishMessages(sidebar.content, docLabels);

  for (const locale of options.translateLocales) {
    for (const artefact of options.artefacts) {
      if (artefact.label === 'module-map') {
        await bumpSummary(
          summary,
          await materializeGeneratedDocTranslation({
            englishContent: artefact.content,
            sourcePath: moduleMapSourcePath(options.layout.repoRoot, artefact.outputPath),
            locale,
            layout: options.layout,
            translator: options.translator,
            dryRun: options.dryRun,
          }),
        );
        continue;
      }
      if (!artefact.label.startsWith('module-reference (')) {
        continue;
      }
      const slug = referenceSlugFromOutputPath(
        artefact.outputPath,
        options.registry.layout.contentRoot,
      );
      if (slug === null) {
        continue;
      }
      await bumpSummary(
        summary,
        await materializeGeneratedDocTranslation({
          englishContent: artefact.content,
          sourcePath: generatedReferenceSourcePath(slug),
          locale,
          layout: options.layout,
          translator: options.translator,
          dryRun: options.dryRun,
        }),
      );
    }

    for (const message of sidebarMessages) {
      await bumpSummary(
        summary,
        await materializeSidebarMessage({
          message,
          locale,
          layout: options.layout,
          translator: options.translator,
          dryRun: options.dryRun,
        }),
      );
    }
  }

  return summary;
}

async function bumpSummary(
  summary: ComposerI18nMaterializeSummary,
  result: { readonly status: 'fresh' | 'translated' | 'would-translate' },
): Promise<void> {
  if (result.status === 'fresh') {
    summary.fresh += 1;
  } else if (result.status === 'translated') {
    summary.translated += 1;
  } else {
    summary.wouldTranslate += 1;
  }
}

export interface ComposerI18nVerifyFinding {
  readonly key: string;
  readonly detail: string;
}

export interface ComposerI18nVerifyOptions {
  readonly artefacts: readonly ComposerDocsArtefact[];
  readonly registry: DocsRegistry;
  readonly translateLocales: readonly string[];
  readonly layout: TranslationCacheLayout;
}

/** Verify pinned PL cache entries for generated composer artefacts (--check). */
export function verifyComposerGeneratedTranslations(
  options: ComposerI18nVerifyOptions,
): readonly ComposerI18nVerifyFinding[] {
  const findings: ComposerI18nVerifyFinding[] = [];
  const docLabels = buildDocLabelMap(options.registry);
  const sidebar = options.artefacts.find((artefact) => artefact.label === 'docs-sidebar');
  const sidebarMessages: readonly SidebarMessage[] =
    sidebar === undefined ? [] : resolveSidebarEnglishMessages(sidebar.content, docLabels);

  for (const locale of options.translateLocales) {
    for (const artefact of options.artefacts) {
      let sourcePath: string | null = null;
      if (artefact.label === 'module-map') {
        sourcePath = moduleMapSourcePath(options.layout.repoRoot, artefact.outputPath);
      } else if (artefact.label.startsWith('module-reference (')) {
        const slug = referenceSlugFromOutputPath(
          artefact.outputPath,
          options.registry.layout.contentRoot,
        );
        sourcePath = slug === null ? null : generatedReferenceSourcePath(slug);
      }
      if (sourcePath === null) {
        continue;
      }
      const verdict = verifyGeneratedDocTranslationCache(
        artefact.content,
        sourcePath,
        locale,
        options.layout,
      );
      if (verdict !== 'ok') {
        findings.push({
          key: `${locale}:${sourcePath}`,
          detail: `${verdict}-translation:${sourcePath}`,
        });
      }
    }

    for (const message of sidebarMessages) {
      const verdict = verifySidebarMessageCache(message, locale, options.layout);
      if (verdict !== 'ok') {
        findings.push({
          key: `${locale}:${message.id}`,
          detail: `${verdict}-sidebar-message:${message.id}`,
        });
      }
    }
  }

  return findings.sort((a, b) => a.key.localeCompare(b.key));
}

export type { MaterializeGeneratedDocTranslationOptions };
