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

/** One ATX heading of a page's outline. */
export interface DocsHeading {
  readonly level: number;
  /** The explicit `{#anchor}` the heading declares, or `null`. */
  readonly anchor: string | null;
  /** The id the heading renders with: its explicit anchor, else its derived slug. */
  readonly id: string;
}

const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_PATTERN = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const EXPLICIT_ANCHOR_PATTERN = /[ \t]*\{#([^}\s]+)\}$/;

/**
 * The slug Docusaurus derives for a heading without an explicit anchor — an
 * approximation of `github-slugger` over the heading's rendered text: link
 * targets, inline HTML and markdown punctuation removed, letters, digits,
 * `_` and `-` kept, spaces turned into `-`. A heading this misreads can only
 * add a finding, never hide one.
 */
export function headingSlug(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '')
    .replace(/ /g, '-');
}

/**
 * The heading outline of a markdown page (issue #1340) — the part of a page a
 * translation keeps one-for-one. Front matter and fenced code are skipped, so
 * a `#` comment in a shell block is not a heading. Repeated ids take the
 * `-1`, `-2` suffixes Docusaurus gives them. Setext (`===` / `---`
 * underline) headings and headings emitted by MDX components are not read:
 * the docs tree writes ATX headings.
 */
export function headingOutline(markdown: string): readonly DocsHeading[] {
  const lines = markdown.split(/\r?\n/);
  let index = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, at) => at > 0 && line.trim() === '---');
    if (end > 0) {
      index = end + 1;
    }
  }
  const outline: DocsHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!;
      continue;
    }
    const heading = HEADING_PATTERN.exec(line);
    if (!heading) {
      continue;
    }
    let text = (heading[2] ?? '').replace(/[ \t]+#+$/, '').replace(/^#+$/, '');
    const explicit = EXPLICIT_ANCHOR_PATTERN.exec(text);
    let id: string;
    if (explicit) {
      text = text.slice(0, explicit.index);
      id = explicit[1]!;
    } else {
      const base = headingSlug(text);
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      id = occurrence === 0 ? base : `${base}-${occurrence}`;
    }
    outline.push({ level: heading[1]!.length, anchor: explicit ? explicit[1]! : null, id });
  }
  return outline;
}

/**
 * How a translation's heading outline diverges from its source's (issue
 * #1340), without reading the heading text a translation changes.
 *
 * Headings are first paired by the id they render with, so an explicit anchor
 * a translator added to match the English heading's derived slug pairs with
 * that heading. A paired heading at another level is `anchor-level`. An
 * unpaired heading that declares an explicit anchor is named
 * (`anchor-only-in-source` / `anchor-only-in-translation`); the unpaired
 * headings without one — translated text, so no id to pair on — are compared
 * as a count per level (`unanchored-h<n>-count:<source>-vs-<translation>`).
 * A section dropped on one side while the other keeps it therefore always
 * shows, by name or as a count; two edits that cancel out within one level of
 * unanchored headings do not.
 */
export function headingOutlineDivergence(
  source: readonly DocsHeading[],
  translation: readonly DocsHeading[],
): readonly string[] {
  const divergences: string[] = [];
  const byId = new Map<string, DocsHeading>();
  for (const heading of translation) {
    if (!byId.has(heading.id)) {
      byId.set(heading.id, heading);
    }
  }
  const pairedTranslation = new Set<DocsHeading>();
  const unpairedSource: DocsHeading[] = [];
  for (const heading of source) {
    const counterpart = byId.get(heading.id);
    if (counterpart === undefined || pairedTranslation.has(counterpart)) {
      unpairedSource.push(heading);
      continue;
    }
    pairedTranslation.add(counterpart);
    if (counterpart.level !== heading.level) {
      divergences.push(`anchor-level:#${heading.id}:h${heading.level}-vs-h${counterpart.level}`);
    }
  }
  const unpairedTranslation = translation.filter((heading) => !pairedTranslation.has(heading));

  const counts = [0, 0, 0, 0, 0, 0, 0];
  const translationCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const heading of unpairedSource) {
    if (heading.anchor !== null) {
      divergences.push(`anchor-only-in-source:#${heading.anchor}`);
    } else {
      counts[heading.level]! += 1;
    }
  }
  for (const heading of unpairedTranslation) {
    if (heading.anchor !== null) {
      divergences.push(`anchor-only-in-translation:#${heading.anchor}`);
    } else {
      translationCounts[heading.level]! += 1;
    }
  }
  for (let level = 1; level <= 6; level += 1) {
    if (counts[level] !== translationCounts[level]) {
      divergences.push(`unanchored-h${level}-count:${counts[level]}-vs-${translationCounts[level]}`);
    }
  }
  return divergences.sort();
}
