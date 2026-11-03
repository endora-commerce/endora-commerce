import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findRepoRoot } from './module-roots.js';

/**
 * One translation pin under `docs/translation-cache/<locale>/`: the English
 * source a translation was made from, and the hash of the English body it was
 * made against.
 *
 * The pin is the whole entry (issue #671). The translation itself is the
 * materialised page under `docs/i18n/<locale>/…`, which is what Docusaurus
 * builds; an entry used to carry a second, byte-identical copy of that page as
 * `content`, which carried no information and put the whole page on one JSON
 * line, so any two branches editing the same page conflicted there.
 */
export interface TranslationCacheEntry {
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly locale: string;
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

/** What a pin file holds: nothing, a well-formed pin, or something else. */
export type CacheEntryReadResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'pin'; readonly entry: TranslationCacheEntry }
  | { readonly kind: 'malformed'; readonly reason: string };

const PIN_KEYS: ReadonlySet<string> = new Set(['sourcePath', 'sourceHash', 'locale', 'meta']);
const META_KEYS: ReadonlySet<string> = new Set(['provider', 'updatedAt']);
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed pin against the file it was read from. Anything beyond the
 * pin — the pre-#671 `content` copy above all — is malformed rather than
 * ignored, so the duplicate cannot drift back in from a branch cut before it
 * was removed.
 */
function parsePin(value: unknown, locale: string, sourcePath: string): CacheEntryReadResult {
  if (!isRecord(value)) {
    return { kind: 'malformed', reason: 'not-an-object' };
  }
  for (const key of Object.keys(value).sort()) {
    if (!PIN_KEYS.has(key)) {
      return { kind: 'malformed', reason: `unexpected-key:${key}` };
    }
  }
  if (value['sourcePath'] !== sourcePath) {
    return { kind: 'malformed', reason: 'invalid-field:sourcePath' };
  }
  if (value['locale'] !== locale) {
    return { kind: 'malformed', reason: 'invalid-field:locale' };
  }
  const hash = value['sourceHash'];
  if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
    return { kind: 'malformed', reason: 'invalid-field:sourceHash' };
  }
  const meta = value['meta'];
  if (
    !isRecord(meta) ||
    Object.keys(meta).some((key) => !META_KEYS.has(key)) ||
    meta['provider'] !== 'manual' ||
    typeof meta['updatedAt'] !== 'string'
  ) {
    return { kind: 'malformed', reason: 'invalid-field:meta' };
  }
  return {
    kind: 'pin',
    entry: {
      sourcePath,
      sourceHash: hash,
      locale,
      meta: { provider: 'manual', updatedAt: meta['updatedAt'] },
    },
  };
}

export function readCacheEntryResult(
  locale: string,
  sourcePath: string,
  layout: TranslationCacheLayout = defaultLayout(),
): CacheEntryReadResult {
  const path = cacheEntryPath(locale, sourcePath, layout);
  if (!existsSync(path)) {
    return { kind: 'absent' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { kind: 'malformed', reason: 'invalid-json' };
  }
  return parsePin(parsed, locale, sourcePath);
}

/** The pin for a source, `null` when there is none; throws on a malformed one. */
export function readCacheEntry(
  locale: string,
  sourcePath: string,
  layout: TranslationCacheLayout = defaultLayout(),
): TranslationCacheEntry | null {
  const result = readCacheEntryResult(locale, sourcePath, layout);
  if (result.kind === 'malformed') {
    throw new Error(
      `[docs-translation-cache] ${cacheEntryPath(locale, sourcePath, layout)} is malformed: ${result.reason}.`,
    );
  }
  return result.kind === 'pin' ? result.entry : null;
}

/** The exact bytes a pin is stored as — one key per line, so a re-pin is a one-line diff. */
export function serializeCacheEntry(entry: TranslationCacheEntry): string {
  const pin: TranslationCacheEntry = {
    sourcePath: entry.sourcePath,
    sourceHash: entry.sourceHash,
    locale: entry.locale,
    meta: { provider: entry.meta.provider, updatedAt: entry.meta.updatedAt },
  };
  return `${JSON.stringify(pin, null, 2)}\n`;
}

export function writeCacheEntry(
  entry: TranslationCacheEntry,
  layout: TranslationCacheLayout = defaultLayout(),
): void {
  const path = cacheEntryPath(entry.locale, entry.sourcePath, layout);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeCacheEntry(entry), 'utf8');
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
