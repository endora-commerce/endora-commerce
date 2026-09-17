import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  DOCS_SIDEBAR_ARTEFACT,
  MODULE_MAP_ARTEFACT,
  MODULE_REFERENCE_CATEGORY,
  MODULES_CATEGORY,
  PAGE_EXTENSIONS,
  type DocPage,
} from './module-docs.js';

/** One English documentation source that must have a manual Polish translation. */
export interface DocsTranslationSource {
  /** Repo-relative cache key (e.g. `docs/docs/intro.md`, `generated:module-reference/catalog`). */
  readonly sourcePath: string;
  /** Absolute path of the English markdown file to read. */
  readonly absolutePath: string;
}

const SIDEBAR_MAIN_PREFIX = 'sidebar.main';

/** Repo-relative paths excluded from machine translation (`docs/translation-skip.json`). */
export function loadTranslationSkipPaths(repoRoot: string): ReadonlySet<string> {
  const skipPath = join(repoRoot, 'docs/translation-skip.json');
  if (!existsSync(skipPath)) {
    return new Set();
  }
  const parsed = JSON.parse(readFileSync(skipPath, 'utf8')) as { paths?: unknown };
  if (!Array.isArray(parsed.paths)) {
    throw new Error('[docs-translation] docs/translation-skip.json must declare a paths array.');
  }
  return new Set(parsed.paths.filter((entry): entry is string => typeof entry === 'string'));
}

function isMarkdownFile(name: string): boolean {
  return PAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function walkMarkdown(
  directory: string,
  skipDirectories: ReadonlySet<string>,
  repoRoot: string,
  prefix = '',
): DocsTranslationSource[] {
  const sources: DocsTranslationSource[] = [];
  if (!existsSync(directory)) {
    return sources;
  }
  for (const name of readdirSync(directory).sort()) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (skipDirectories.has(name)) {
        continue;
      }
      sources.push(...walkMarkdown(full, skipDirectories, repoRoot, `${prefix}${name}/`));
      continue;
    }
    if (!isMarkdownFile(name)) {
      continue;
    }
    const sourcePath = relative(repoRoot, full).split('\\').join('/');
    sources.push({ sourcePath, absolutePath: full });
  }
  return sources;
}

/** Layer-1 hand-authored pages under `docs/docs/`, excluding generated categories. */
export function collectHandAuthoredSources(
  repoRoot: string,
  contentRoot: string,
): readonly DocsTranslationSource[] {
  return walkMarkdown(
    contentRoot,
    new Set([MODULE_REFERENCE_CATEGORY, MODULES_CATEGORY]),
    repoRoot,
  ).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

/** Layer-2 generated module reference pages committed under `docs/docs/module-reference/`. */
export function collectGeneratedReferenceSources(
  _repoRoot: string,
  contentRoot: string,
): readonly DocsTranslationSource[] {
  const referenceRoot = join(contentRoot, MODULE_REFERENCE_CATEGORY);
  if (!existsSync(referenceRoot)) {
    return [];
  }
  return readdirSync(referenceRoot)
    .filter((name) => isMarkdownFile(name))
    .map((name) => {
      const absolutePath = join(referenceRoot, name);
      const slug = name.replace(/\.mdx?$/, '');
      return {
        sourcePath: `generated:module-reference/${slug}`,
        absolutePath,
      };
    })
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

/** Layer-3 generated module map page, when present. */
export function collectGeneratedModuleMapSource(
  repoRoot: string,
  modulesRoot: string,
): DocsTranslationSource | null {
  const absolutePath = join(modulesRoot, MODULE_MAP_ARTEFACT);
  if (!existsSync(absolutePath)) {
    return null;
  }
  return {
    sourcePath: relative(repoRoot, absolutePath).split('\\').join('/'),
    absolutePath,
  };
}

/** Layer-4 module-owned documentation sources under each module's docs directory. */
export function collectModuleOwnedSources(
  repoRoot: string,
  modulePages: readonly DocPage[],
): readonly DocsTranslationSource[] {
  return modulePages
    .map((page) => ({
      sourcePath: relative(repoRoot, page.path).split('\\').join('/'),
      absolutePath: page.path,
    }))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

/** Every English source FR-022 expects to have a cache entry and materialized file. */
export function collectAllDocsTranslationSources(
  repoRoot: string,
  contentRoot: string,
  modulesRoot: string,
  modulePages: readonly DocPage[],
): readonly DocsTranslationSource[] {
  const sources = [
    ...collectHandAuthoredSources(repoRoot, contentRoot),
    ...collectGeneratedReferenceSources(repoRoot, contentRoot),
    ...collectModuleOwnedSources(repoRoot, modulePages),
  ];
  const moduleMap = collectGeneratedModuleMapSource(repoRoot, modulesRoot);
  if (moduleMap !== null) {
    sources.push(moduleMap);
  }
  return sources.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

/** Sources the maintainer translate command walks in Phase 2 (layers 1 and 4). */
export function collectTranslateCommandSources(
  repoRoot: string,
  contentRoot: string,
  modulePages: readonly DocPage[],
): readonly DocsTranslationSource[] {
  return [
    ...collectHandAuthoredSources(repoRoot, contentRoot),
    ...collectModuleOwnedSources(repoRoot, modulePages),
  ].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function messageIdForDocKey(key: string): string {
  return `${SIDEBAR_MAIN_PREFIX}.doc.${key}`;
}

function messageIdForCategoryKey(key: string): string {
  return `${SIDEBAR_MAIN_PREFIX}.category.${key}`;
}

/** Collect sidebar message ids from one sidebar fragment's source text. */
export function sidebarMessageIdsIn(source: string): readonly string[] {
  const ids = new Set<string>();

  for (const match of source.matchAll(/type:\s*'category'[\s\S]*?key:\s*'([^']+)'/g)) {
    ids.add(messageIdForCategoryKey(match[1]!));
  }
  for (const match of source.matchAll(/type:\s*"category"[\s\S]*?key:\s*"([^"]+)"/g)) {
    ids.add(messageIdForCategoryKey(match[1]!));
  }
  for (const match of source.matchAll(
    /type:\s*'doc'[^}]*?key:\s*'([^']+)'/g,
  )) {
    ids.add(messageIdForDocKey(match[1]!));
  }
  for (const match of source.matchAll(
    /type:\s*"doc"[^}]*?key:\s*"([^"]+)"/g,
  )) {
    ids.add(messageIdForDocKey(match[1]!));
  }
  for (const match of source.matchAll(/^\s*'([a-z0-9][a-z0-9_./-]*)',?\s*$/gm)) {
    ids.add(messageIdForDocKey(match[1]!));
  }
  for (const match of source.matchAll(/^\s*"([a-z0-9][a-z0-9_./-]*)",?\s*$/gm)) {
    ids.add(messageIdForDocKey(match[1]!));
  }

  return [...ids].sort();
}

/** Sidebar message ids from hand-maintained and generated sidebar fragments. */
export function collectSidebarMessageIds(
  _repoRoot: string,
  docsMemberDir: string,
): readonly string[] {
  const ids = new Set<string>();
  const handSidebar = join(docsMemberDir, 'sidebars.js');
  const generatedSidebar = join(docsMemberDir, DOCS_SIDEBAR_ARTEFACT);
  if (existsSync(handSidebar)) {
    for (const id of sidebarMessageIdsIn(readFileSync(handSidebar, 'utf8'))) {
      ids.add(id);
    }
  }
  if (existsSync(generatedSidebar)) {
    for (const id of sidebarMessageIdsIn(readFileSync(generatedSidebar, 'utf8'))) {
      ids.add(id);
    }
  }
  return [...ids].sort();
}

/** Resolve documentation layout and module-owned pages for translation/check scripts. */
export async function resolveDocsTranslationLayout(): Promise<{
  readonly repoRoot: string;
  readonly contentRoot: string;
  readonly modulesRoot: string;
  readonly docsMemberDir: string;
  readonly modulePages: readonly DocPage[];
  readonly skipPaths: ReadonlySet<string>;
}> {
  const { resolveModuleDocs } = await import('./module-docs.js');
  const { requireModuleLayout } = await import('./module-roots.js');
  const layout = await requireModuleLayout('[docs-translation]');
  const resolved = await resolveModuleDocs(layout.repoRoot, layout.manifestIndexPath);
  return {
    repoRoot: layout.repoRoot,
    contentRoot: resolved.docs.contentRoot,
    modulesRoot: resolved.docs.modulesRoot,
    docsMemberDir: resolved.docs.member.dir,
    modulePages: resolved.modulePages,
    skipPaths: loadTranslationSkipPaths(layout.repoRoot),
  };
}
