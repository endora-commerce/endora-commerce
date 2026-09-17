import { readFileSync } from 'node:fs';

import type { DocsTextTranslator } from './docs-deepl-client.js';
import {
  hashSourceBody,
  restoreSegmentMarkdown,
  segmentMarkdown,
  splitFrontMatter,
} from './docs-markdown-segments.js';
import {
  INTRO_MT_DISCLAIMER_PL,
  type DocsTranslationSource,
} from './docs-translation-sources.js';
import {
  isCacheHit,
  materializeTranslation,
  readCacheEntry,
  writeCacheEntry,
  type TranslationCacheEntry,
  type TranslationCacheLayout,
} from './docs-translation-cache.js';

const FRONT_MATTER_FIELD_PATTERN = /^(\s*(?:title|sidebar_label):\s*)(.+)$/gm;

function translateFrontMatterFields(
  prefix: string,
  translator: DocsTextTranslator,
  targetLocale: string,
): Promise<string> {
  const fields: { index: number; value: string }[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(FRONT_MATTER_FIELD_PATTERN.source, FRONT_MATTER_FIELD_PATTERN.flags);
  while ((match = pattern.exec(prefix)) !== null) {
    const raw = match[2]!.trim();
    const unquoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
    fields.push({ index: fields.length, value: unquoted });
  }
  if (fields.length === 0) {
    return Promise.resolve(prefix);
  }
  return translator
    .translateTexts(
      fields.map((field) => field.value),
      targetLocale,
    )
    .then((translations) => {
      let fieldIndex = 0;
      return prefix.replace(
        new RegExp(FRONT_MATTER_FIELD_PATTERN.source, FRONT_MATTER_FIELD_PATTERN.flags),
        (_whole, lead: string, rawValue: string) => {
          const translated = translations[fieldIndex] ?? fields[fieldIndex]?.value ?? rawValue.trim();
          fieldIndex += 1;
          const trimmed = rawValue.trim();
          if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
            const quote = trimmed[0]!;
            return `${lead}${quote}${translated}${quote}`;
          }
          return `${lead}${translated}`;
        },
      );
    });
}

function applyIntroDisclaimer(sourcePath: string, locale: string, content: string): string {
  if (locale !== 'pl' || sourcePath !== 'docs/docs/intro.md') {
    return content;
  }
  const { prefix, body } = splitFrontMatter(content);
  if (body.includes(':::caution Tłumaczenie maszynowe')) {
    return content;
  }
  return `${prefix}${INTRO_MT_DISCLAIMER_PL}${body}`;
}

export interface TranslateDocumentOptions {
  readonly source: DocsTranslationSource;
  readonly locale: string;
  readonly layout: TranslationCacheLayout;
  readonly translator: DocsTextTranslator;
  readonly dryRun?: boolean;
}

export interface TranslateDocumentResult {
  readonly status: 'skipped' | 'fresh' | 'translated' | 'would-translate';
  readonly entry: TranslationCacheEntry | null;
}

/** Translate one English source into a cache entry and materialize it. */
export async function translateDocument(
  options: TranslateDocumentOptions,
): Promise<TranslateDocumentResult> {
  const english = readFileSync(options.source.absolutePath, 'utf8');
  const existing = readCacheEntry(options.locale, options.source.sourcePath, options.layout);
  if (isCacheHit(existing, english)) {
    return { status: 'fresh', entry: existing };
  }

  if (options.dryRun === true) {
    return { status: 'would-translate', entry: null };
  }

  const segmented = segmentMarkdown(english);
  const translatedSegments =
    segmented.segments.length === 0
      ? []
      : await options.translator.translateTexts(segmented.segments, options.locale);
  const translatedPrefix = await translateFrontMatterFields(
    segmented.prefix,
    options.translator,
    options.locale,
  );
  let content = restoreSegmentMarkdown(
    { ...segmented, prefix: translatedPrefix },
    translatedSegments,
  );
  content = applyIntroDisclaimer(options.source.sourcePath, options.locale, content);

  const entry: TranslationCacheEntry = {
    sourcePath: options.source.sourcePath,
    sourceHash: hashSourceBody(english),
    locale: options.locale,
    content,
    meta: {
      provider: 'deepl',
      translatedAt: new Date().toISOString(),
    },
  };
  writeCacheEntry(entry, options.layout);
  materializeTranslation(entry, options.layout);
  return { status: 'translated', entry };
}
