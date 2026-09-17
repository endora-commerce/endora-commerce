import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DocsTextTranslator } from './docs-deepl-client.js';
import { hashSourceBody } from './docs-markdown-segments.js';
import {
  cacheEntryPath,
  isCacheHit,
  readCacheEntry,
  writeCacheEntry,
  type TranslationCacheEntry,
  type TranslationCacheLayout,
} from './docs-translation-cache.js';
import { sidebarMessageIdsIn } from './docs-translation-sources.js';

/** One sidebar label keyed by its Docusaurus message id. */
export interface SidebarMessage {
  readonly id: string;
  readonly message: string;
}

const SIDEBAR_CACHE_PREFIX = 'generated:sidebar/';

/** Cache key for a sidebar message id. */
export function sidebarMessageSourcePath(messageId: string): string {
  return `${SIDEBAR_CACHE_PREFIX}${messageId}`;
}

function unescapeJsString(value: string): string {
  return value.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function docKeyFromMessageId(messageId: string): string {
  const docPrefix = 'sidebar.main.doc.';
  const categoryPrefix = 'sidebar.main.category.';
  if (messageId.startsWith(docPrefix)) {
    return messageId.slice(docPrefix.length);
  }
  if (messageId.startsWith(categoryPrefix)) {
    return messageId.slice(categoryPrefix.length);
  }
  throw new Error(`[docs-sidebar-i18n] unsupported sidebar message id: ${messageId}`);
}

/** Parse explicit `label` + `key` pairs from a sidebar fragment. */
export function explicitSidebarLabelsIn(source: string): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();

  for (const match of source.matchAll(
    /type:\s*'category'[\s\S]*?label:\s*'((?:\\'|[^'])*)'[\s\S]*?key:\s*'([^']+)'/g,
  )) {
    labels.set(`sidebar.main.category.${match[2]!}`, unescapeJsString(match[1]!));
  }
  for (const match of source.matchAll(
    /type:\s*"category"[\s\S]*?label:\s*"((?:\\"|[^"])*)"[\s\S]*?key:\s*"([^"]+)"/g,
  )) {
    labels.set(`sidebar.main.category.${match[2]!}`, unescapeJsString(match[1]!));
  }
  for (const match of source.matchAll(
    /type:\s*'doc'[^}]*?label:\s*'((?:\\'|[^'])*)'[^}]*?key:\s*'([^']+)'/g,
  )) {
    labels.set(`sidebar.main.doc.${match[2]!}`, unescapeJsString(match[1]!));
  }
  for (const match of source.matchAll(
    /type:\s*"doc"[^}]*?label:\s*"((?:\\"|[^"])*)"[^}]*?key:\s*"([^"]+)"/g,
  )) {
    labels.set(`sidebar.main.doc.${match[2]!}`, unescapeJsString(match[1]!));
  }

  return labels;
}

/** Resolve English sidebar messages for every id in a sidebar fragment. */
export function resolveSidebarEnglishMessages(
  sidebarContent: string,
  docLabels: ReadonlyMap<string, string>,
): readonly SidebarMessage[] {
  const explicit = explicitSidebarLabelsIn(sidebarContent);
  return sidebarMessageIdsIn(sidebarContent).map((id) => {
    const explicitLabel = explicit.get(id);
    if (explicitLabel !== undefined) {
      return { id, message: explicitLabel };
    }
    const docKey = docKeyFromMessageId(id);
    const fromDoc = docLabels.get(docKey);
    if (fromDoc !== undefined) {
      return { id, message: fromDoc };
    }
    return { id, message: docKey };
  });
}

function codeJsonPath(locale: string, layout: TranslationCacheLayout): string {
  return join(layout.repoRoot, 'docs/i18n', locale, 'code.json');
}

function readCodeJson(locale: string, layout: TranslationCacheLayout): Record<string, unknown> {
  const path = codeJsonPath(locale, layout);
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** Merge one sidebar message into `docs/i18n/<locale>/code.json`. */
export function materializeSidebarMessageEntry(
  entry: TranslationCacheEntry,
  layout: TranslationCacheLayout,
): string {
  const path = codeJsonPath(entry.locale, layout);
  const existing = readCodeJson(entry.locale, layout);
  const messageId = entry.sourcePath.slice(SIDEBAR_CACHE_PREFIX.length);
  const next = {
    ...existing,
    [messageId]: { message: entry.content },
  };
  mkdirSync(join(layout.repoRoot, 'docs/i18n', entry.locale), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return path;
}

export interface MaterializeSidebarMessageOptions {
  readonly message: SidebarMessage;
  readonly locale: string;
  readonly layout: TranslationCacheLayout;
  readonly translator: DocsTextTranslator;
  readonly dryRun?: boolean;
}

export interface MaterializeSidebarMessageResult {
  readonly status: 'fresh' | 'translated' | 'would-translate';
  readonly entry: TranslationCacheEntry | null;
}

/** Translate one sidebar label, pin cache, and write `code.json`. */
export async function materializeSidebarMessage(
  options: MaterializeSidebarMessageOptions,
): Promise<MaterializeSidebarMessageResult> {
  const sourcePath = sidebarMessageSourcePath(options.message.id);
  const existing = readCacheEntry(options.locale, sourcePath, options.layout);
  if (isCacheHit(existing, options.message.message)) {
    if (existing !== null) {
      materializeSidebarMessageEntry(existing, options.layout);
    }
    return { status: 'fresh', entry: existing };
  }

  if (options.dryRun === true) {
    return { status: 'would-translate', entry: null };
  }

  const [translated] = await options.translator.translateTexts(
    [options.message.message],
    options.locale,
  );
  const entry: TranslationCacheEntry = {
    sourcePath,
    sourceHash: hashSourceBody(options.message.message),
    locale: options.locale,
    content: translated ?? options.message.message,
    meta: {
      provider: 'deepl',
      translatedAt: new Date().toISOString(),
    },
  };
  writeCacheEntry(entry, options.layout);
  materializeSidebarMessageEntry(entry, options.layout);
  return { status: 'translated', entry };
}

export type GeneratedTranslationCacheVerdict = 'ok' | 'missing' | 'stale';

/** Verify a pinned sidebar message cache entry and its `code.json` row. */
export function verifySidebarMessageCache(
  message: SidebarMessage,
  locale: string,
  layout: TranslationCacheLayout,
): GeneratedTranslationCacheVerdict {
  const sourcePath = sidebarMessageSourcePath(message.id);
  const entry = readCacheEntry(locale, sourcePath, layout);
  if (entry === null) {
    return 'missing';
  }
  if (!isCacheHit(entry, message.message)) {
    return 'stale';
  }
  const codeJson = readCodeJson(locale, layout);
  const row = codeJson[message.id];
  if (
    row === null ||
    typeof row !== 'object' ||
    !('message' in row) ||
    typeof (row as { message: unknown }).message !== 'string'
  ) {
    return 'missing';
  }
  if ((row as { message: string }).message !== entry.content) {
    return 'stale';
  }
  return 'ok';
}

/** Absolute cache path for tests and diagnostics. */
export function sidebarCacheEntryPath(
  messageId: string,
  locale: string,
  layout: TranslationCacheLayout,
): string {
  return cacheEntryPath(locale, sidebarMessageSourcePath(messageId), layout);
}
