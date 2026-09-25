import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findRepoRoot } from './module-roots.js';

/** One pinned translation entry under `docs/translation-cache/<locale>/`. */
export interface TranslationCacheEntry {
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly locale: string;
  readonly content: string;
  readonly meta: {
    readonly provider: 'manual';
    readonly updatedAt: string;
  };
}

export interface TranslationCacheLayout {
  readonly repoRoot: string;
  readonly cacheRoot: string;
  readonly i18nDocsRoot: (locale: string) => string;
}

function stripBom(source: string): string {
  return source.startsWith('\uFEFF') ? source.slice(1) : source;
}

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function frontMatterBlockStart(source: string): number {
  if (source.startsWith('---\n') || source.startsWith('---\r\n')) {
    return 0;
  }
  const match = /\n---[\r\n]/.exec(source);
  return match === null ? -1 : match.index + 1;
}

/** Split markdown into an opaque prefix (preamble + YAML front matter) and body. */
function splitFrontMatter(source: string): { prefix: string; body: string } {
  const text = stripBom(source);
  const start = frontMatterBlockStart(text);
  if (start === -1) {
    return { prefix: '', body: text };
  }

  const lineBreak = text.indexOf('\n', start);
  if (lineBreak === -1) {
    return { prefix: '', body: text };
  }

  const close = text.indexOf('\n---', lineBreak + 1);
  if (close === -1) {
    return { prefix: '', body: text };
  }

  const afterClose = close + 4;
  const trailingNewline = text[afterClose] === '\n' ? 1 : 0;
  const prefixEnd = afterClose + trailingNewline;
  return {
    prefix: text.slice(0, prefixEnd),
    body: text.slice(prefixEnd),
  };
}

/** sha256 of the normalised English body with front matter stripped. */
export function hashSourceBody(source: string): string {
  const { body } = splitFrontMatter(source);
  return createHash('sha256').update(normalizeLineEndings(body), 'utf8').digest('hex');
}

export function defaultTranslationCacheLayout(
  repoRoot: string = findRepoRoot(fileURLToPath(new URL('.', import.meta.url))) ?? '',
): TranslationCacheLayout {
  if (repoRoot.length === 0) {
    throw new Error('[docs-translation-cache] could not locate repository root.');
  }
  return {
    repoRoot,
    cacheRoot: join(repoRoot, 'docs/translation-cache'),
    i18nDocsRoot: (locale: string) =>
      join(repoRoot, 'docs/i18n', locale, 'docusaurus-plugin-content-docs/current'),
  };
}

function defaultLayout(): TranslationCacheLayout {
  return defaultTranslationCacheLayout();
}

/** Filesystem-safe cache filename stem for a repo-relative `sourcePath`. */
export function sourceKeyOf(sourcePath: string): string {
  return sourcePath.replace(/\//g, '--');
}

/** Resolve the Docusaurus doc id for a cache `sourcePath`. */
export function docIdFromSourcePath(sourcePath: string): string {
  if (sourcePath.startsWith('generated:module-reference/')) {
    return `module-reference/${sourcePath.slice('generated:module-reference/'.length)}`;
  }
  if (sourcePath.startsWith('generated:')) {
    throw new Error(`[docs-translation-cache] unsupported generated source path: ${sourcePath}`);
  }
  if (sourcePath.startsWith('docs/docs/') && sourcePath.endsWith('.md')) {
    return sourcePath.slice('docs/docs/'.length, -'.md'.length);
  }
  const moduleMatch = /^packages\/modules\/[^/]+\/docs\/(.+\.mdx?)$/.exec(sourcePath);
  if (moduleMatch !== null) {
    const relative = moduleMatch[1]!.replace(/\.mdx?$/, '');
    const nested = /^([^/]+)\/([^/]+)$/.exec(relative);
    if (nested !== null) {
      return `modules/${nested[1]}/${nested[2]}`;
    }
    return `modules/${relative}`;
  }
  throw new Error(`[docs-translation-cache] cannot derive doc id from ${sourcePath}.`);
}

/** Absolute path of a cache JSON file. */
export function cacheEntryPath(
  locale: string,
  sourcePath: string,
  layout: TranslationCacheLayout = defaultLayout(),
): string {
  return join(layout.cacheRoot, locale, `${sourceKeyOf(sourcePath)}.json`);
}

/** Absolute path of the materialized i18n markdown file for a doc id. */
export function materializedDocPath(
  locale: string,
  docId: string,
  layout: TranslationCacheLayout = defaultLayout(),
): string {
  return join(layout.i18nDocsRoot(locale), `${docId}.md`);
}

export function readCacheEntry(
  locale: string,
  sourcePath: string,
  layout: TranslationCacheLayout = defaultLayout(),
): TranslationCacheEntry | null {
  const path = cacheEntryPath(locale, sourcePath, layout);
  if (!existsSync(path)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as TranslationCacheEntry;
  return parsed;
}

export function writeCacheEntry(
  entry: TranslationCacheEntry,
  layout: TranslationCacheLayout = defaultLayout(),
): void {
  const path = cacheEntryPath(entry.locale, entry.sourcePath, layout);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
}

/** True when an existing cache entry matches the current English source hash. */
export function isCacheHit(entry: TranslationCacheEntry | null, englishSource: string): boolean {
  if (entry === null) {
    return false;
  }
  const currentHash = hashSourceBody(englishSource);
  const left = Buffer.from(entry.sourceHash, 'utf8');
  const right = Buffer.from(currentHash, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Write cache entry content to the Docusaurus i18n docs tree. */
export function materializeTranslation(
  entry: TranslationCacheEntry,
  layout: TranslationCacheLayout = defaultLayout(),
): string {
  const docId = docIdFromSourcePath(entry.sourcePath);
  const target = materializedDocPath(entry.locale, docId, layout);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, entry.content, 'utf8');
  return target;
}
