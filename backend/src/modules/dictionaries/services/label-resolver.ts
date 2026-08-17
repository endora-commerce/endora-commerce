import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CurrencyReadPort,
  type DictionaryEntryType,
  type LanguageReadPort,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
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
  /**
   * Feature 075, Phase C — the fallback chain is walked in `languages`' table
   * and a canonical currency or language label is read from its owner's, so
   * both go through the published read ports. Issue #142's property is
   * unchanged: `list()` is one statement, exactly as the `em.find(Language,
   * {})` it replaces was, so the cold registry build stays at seven.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly currencies: CurrencyReadPort,
    private readonly languages: LanguageReadPort,
  ) {}

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
    const chain = buildFallbackChain(locale, await this.languages.list());
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
    const canonical = await this.canonicalLabel(args.entryType, args.entryCode);
    if (!canonical) throw notFound(args.entryType, args.entryCode);
    if (!args.locale) return canonical;

    const labels = await this.resolveLabels(
      [{ entryType: args.entryType, entryCode: args.entryCode, canonicalLabel: canonical }],
      args.locale,
    );
    return labels.get(labelKey(args.entryType, args.entryCode)) ?? canonical;
  }

  /** The label the entry's own row carries, from whichever module owns it. */
  private async canonicalLabel(
    entryType: DictionaryEntryType,
    entryCode: string,
  ): Promise<string | null> {
    if (entryType === 'country') {
      return (await this.emFactory().findOne(Country, { code: entryCode }))?.label ?? null;
    }
    if (entryType === 'currency') {
      return (await this.currencies.findByCode(entryCode))?.label ?? null;
    }
    return (await this.languages.findByCode(entryCode))?.label ?? null;
  }
}

/**
 * The locale, then each `fallbackCode` after it — the same walk the per-entry
 * resolver used to make one statement at a time. A locale no `Language` row
 * knows ends the chain, and a cycle ends it too.
 */
export function buildFallbackChain(
  locale: string,
  languages: readonly { code: string; fallbackCode?: string | null }[],
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

function notFound(entryType: DictionaryEntryType, entryCode: string): HttpError {
  return new HttpError(
    404,
    ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
    `Dictionary ${entryType} ${entryCode} not found.`,
  );
}
