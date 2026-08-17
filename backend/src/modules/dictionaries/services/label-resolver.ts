import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type DictionaryEntryType } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Currency } from '../../currencies/entities/currency.entity.js';
import { Language } from '../../languages/entities/language.entity.js';
import { Country } from '../entities/country.entity.js';
import { DictionaryTranslation } from '../entities/dictionary-translation.entity.js';

/** Locale fallback chains never walk deeper than this, cycles included. */
const MAX_FALLBACK_DEPTH = 10;

export interface ResolveLabelArgs {
  entryType: DictionaryEntryType;
  entryCode: string;
  locale?: string;
}

/** One entry to label, with the canonical label its own row already carries. */
export interface LabelBatchEntry {
  entryType: DictionaryEntryType;
  entryCode: string;
  canonicalLabel: string;
}

/** Key into the map {@link LabelResolver.resolveLabels} returns. */
export function labelKey(entryType: DictionaryEntryType, entryCode: string): string {
  return `${entryType}:${entryCode}`;
}

export class LabelResolver {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Labels for a whole batch, in a **constant** number of statements: one for
   * the language table the fallback chain is walked in, one for every
   * translation any entry in the batch could use.
   *
   * Issue #142 — the registry called {@link resolveLabel} once per entry, and
   * each call re-read the canonical row, then the translation, then the
   * fallback language, one statement at a time on one connection. Over the 72
   * entries a seeded registry answers that was ~170 sequential round trips, and
   * it grew with the dictionary. The fallback chain in particular depends only
   * on the locale, so it was the same walk repeated once per entry.
   *
   * Callers already hold the rows, so the canonical label is passed in rather
   * than read back; an entry with no translation in the chain keeps it.
   */
  async resolveLabels(
    entries: readonly LabelBatchEntry[],
    locale?: string,
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    for (const entry of entries) {
      labels.set(labelKey(entry.entryType, entry.entryCode), entry.canonicalLabel);
    }
    if (!locale || entries.length === 0) return labels;

    const em = this.emFactory();
    const chain = buildFallbackChain(locale, await em.find(Language, {}));
    const rows = await em.find(DictionaryTranslation, {
      languageCode: { $in: chain },
      entryType: { $in: [...new Set(entries.map((entry) => entry.entryType))] },
      entryCode: { $in: [...new Set(entries.map((entry) => entry.entryCode))] },
    });

    // Earlier in the chain wins, which is what walking it in order used to mean.
    const rank = new Map(chain.map((code, index) => [code, index]));
    const bestRank = new Map<string, number>();
    for (const row of rows) {
      const key = labelKey(row.entryType, row.entryCode);
      // The `$in` filters are a cross product, so a row can match a code of one
      // entry type under another's. Only keys the batch asked for are labelled.
      if (!labels.has(key)) continue;
      const candidate = rank.get(row.languageCode);
      if (candidate === undefined) continue;
      const current = bestRank.get(key);
      if (current !== undefined && current <= candidate) continue;
      bestRank.set(key, candidate);
      labels.set(key, row.label);
    }
    return labels;
  }

  async resolveLabel(args: ResolveLabelArgs): Promise<string> {
    const em = this.emFactory();
    const canonical = await getCanonicalLabel(em, args.entryType, args.entryCode);
    if (!canonical) throw notFound(args.entryType, args.entryCode);
    if (!args.locale) return canonical;

    const labels = await this.resolveLabels(
      [{ entryType: args.entryType, entryCode: args.entryCode, canonicalLabel: canonical }],
      args.locale,
    );
    return labels.get(labelKey(args.entryType, args.entryCode)) ?? canonical;
  }
}

/**
 * The locale, then each `fallbackCode` after it — the same walk the per-entry
 * resolver used to make one statement at a time. A locale no `Language` row
 * knows ends the chain, and a cycle ends it too.
 */
export function buildFallbackChain(
  locale: string,
  languages: readonly Pick<Language, 'code' | 'fallbackCode'>[],
): string[] {
  const fallbackByCode = new Map(languages.map((row) => [row.code, row.fallbackCode ?? null]));
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | null = locale;
  for (let depth = 0; current && depth < MAX_FALLBACK_DEPTH && !visited.has(current); depth += 1) {
    visited.add(current);
    chain.push(current);
    current = fallbackByCode.get(current) ?? null;
  }
  return chain;
}

async function getCanonicalLabel(
  em: EntityManager,
  entryType: DictionaryEntryType,
  entryCode: string,
): Promise<string | null> {
  if (entryType === 'country') {
    return (await em.findOne(Country, { code: entryCode }))?.label ?? null;
  }
  if (entryType === 'currency') {
    return (await em.findOne(Currency, { code: entryCode }))?.label ?? null;
  }
  return (await em.findOne(Language, { code: entryCode }))?.label ?? null;
}

function notFound(entryType: DictionaryEntryType, entryCode: string): HttpError {
  return new HttpError(
    404,
    ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
    `Dictionary ${entryType} ${entryCode} not found.`,
  );
}
