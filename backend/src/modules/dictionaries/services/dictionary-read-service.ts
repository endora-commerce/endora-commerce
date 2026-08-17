import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CurrencyReadPort,
  type DictionaryByCodeResponse,
  type DictionaryEntryType,
  type DictionaryRegistryResponse,
  type LanguageReadPort,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { Country } from '../entities/country.entity.js';
import { LanguageCountry } from '../entities/language-country.entity.js';
import { DictionaryCache, GLOBAL_CACHE_KEY_SEGMENT } from './dictionary-cache.js';
import { LabelResolver, labelKey, type LabelBatchEntry } from './label-resolver.js';

export interface DictionaryRegistryArgs {
  channelCode?: string;
  locale?: string;
}

export interface DictionaryByCodeArgs {
  entryType: DictionaryEntryType;
  entryCode: string;
  locale?: string;
}

export class DictionaryReadService {
  /**
   * Feature 075, Phase C — the registry is assembled from three tables, and
   * only `countries` is this module's. The currency and language rows come
   * from their owners' read ports instead of `em.find(Currency, …)` /
   * `em.find(Language, …)`, which kept answering out of modules an operator had
   * switched off, because deactivation drops no tables.
   *
   * Each port call is one statement, exactly like the query it replaces, so the
   * cold-build ceiling issue #142 pinned at seven is unchanged.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly currencies: CurrencyReadPort,
    private readonly languages: LanguageReadPort,
    private readonly cache?: DictionaryCache,
    private readonly labelResolver: LabelResolver = new LabelResolver(
      emFactory,
      currencies,
      languages,
    ),
  ) {}

  async getRegistry(args: DictionaryRegistryArgs = {}): Promise<DictionaryRegistryResponse> {
    const ctx = await this.resolveContext(args);
    const cacheKey = DictionaryCache.registryKey(ctx.cacheChannelKey, ctx.locale);
    const cached = await this.cache?.get<DictionaryRegistryResponse>(cacheKey);
    if (cached) return cached;

    const em = this.emFactory();
    const [countries, currencies, languages, links] = await Promise.all([
      em.find(Country, { isActive: true }, { orderBy: { sortOrder: 'asc', label: 'asc' } }),
      this.currencies.listActive(),
      this.languages.listActive(),
      em.find(LanguageCountry, {}),
    ]);

    const scopedCurrencies = ctx.channel
      ? currencies.filter((row) => ctx.channel?.currencies.includes(row.code))
      : currencies;
    const scopedLanguages = ctx.channel
      ? languages.filter((row) => ctx.channel?.languages.includes(row.code))
      : languages;

    const countryLinks = groupCountryLinks(links);
    // Issue #142 — one batch, not one resolution per entry. The rows above
    // already carry their canonical labels, so the only thing left to read is
    // the translation each entry may have in the locale's fallback chain, and
    // that is one statement for the whole registry however large it grows.
    const labels = await this.labelResolver.resolveLabels(
      [
        ...countries.map((row) => canonical('country', row.code, row.label)),
        ...scopedCurrencies.map((row) => canonical('currency', row.code, row.label)),
        ...scopedLanguages.map((row) => canonical('language', row.code, row.label)),
      ],
      ctx.locale,
    );
    const payload: DictionaryRegistryResponse = {
      data: {
        countries: countries.map((row) => ({
          code: row.code,
          label: labels.get(labelKey('country', row.code)) ?? row.label,
          alpha3Code: row.alpha3Code,
          numericCode: row.numericCode,
          region: row.region as DictionaryRegistryResponse['data']['countries'][number]['region'],
          subregion: row.subregion ?? null,
          dialCode: row.dialCode ?? null,
          isEuMember: row.isEuMember,
          defaultCurrencyCode: row.defaultCurrencyCode ?? null,
          sortOrder: row.sortOrder,
        })),
        currencies: scopedCurrencies.map((row) => ({
          code: row.code,
          label: labels.get(labelKey('currency', row.code)) ?? row.label,
          symbol: row.symbol,
          symbolPosition: row.symbolPosition,
          decimalPlaces: row.decimalPlaces,
          sortOrder: row.sortOrder,
        })),
        languages: scopedLanguages.map((row) => ({
          code: row.code,
          label: labels.get(labelKey('language', row.code)) ?? row.label,
          nativeLabel: row.nativeLabel || row.label,
          isRtl: row.isRtl,
          fallbackCode: row.fallbackCode ?? null,
          countries: countryLinks.get(row.code) ?? [],
          sortOrder: row.sortOrder,
        })),
        defaults: {
          country: countries.find((row) => row.isDefault)?.code ?? null,
          currency: ctx.channel?.defaultCurrency ?? scopedCurrencies.find((row) => row.isDefault)?.code ?? null,
          language: ctx.channel?.defaultLanguage ?? scopedLanguages.find((row) => row.isDefault)?.code ?? null,
        },
      },
    };
    await this.cache?.set(cacheKey, payload);
    return payload;
  }

  async getByCode(args: DictionaryByCodeArgs): Promise<DictionaryByCodeResponse> {
    const locale = args.locale ?? (await this.resolveDefaultLocale());
    const cacheKey = DictionaryCache.byCodeKey(args.entryType, args.entryCode, locale);
    const cached = await this.cache?.get<DictionaryByCodeResponse>(cacheKey);
    if (cached) return cached;

    const em = this.emFactory();
    if (args.entryType === 'country') {
      const row = await em.findOne(Country, { code: args.entryCode });
      if (!row) throw notFound('country', args.entryCode);
      const payload: DictionaryByCodeResponse = {
        data: {
          entryType: 'country',
          entry: {
            code: row.code,
            label: await this.labelResolver.resolveLabel({
              entryType: 'country',
              entryCode: row.code,
              locale,
            }),
            alpha3Code: row.alpha3Code,
            numericCode: row.numericCode,
            region: row.region as DictionaryRegistryResponse['data']['countries'][number]['region'],
            subregion: row.subregion ?? null,
            dialCode: row.dialCode ?? null,
            isEuMember: row.isEuMember,
            defaultCurrencyCode: row.defaultCurrencyCode ?? null,
            sortOrder: row.sortOrder,
            isActive: row.isActive,
          },
        },
      };
      await this.cache?.set(cacheKey, payload);
      return payload;
    }

    if (args.entryType === 'currency') {
      const row = await this.currencies.findByCode(args.entryCode);
      if (!row) throw notFound('currency', args.entryCode);
      const payload: DictionaryByCodeResponse = {
        data: {
          entryType: 'currency',
          entry: {
            code: row.code,
            label: await this.labelResolver.resolveLabel({
              entryType: 'currency',
              entryCode: row.code,
              locale,
            }),
            symbol: row.symbol,
            symbolPosition: row.symbolPosition,
            decimalPlaces: row.decimalPlaces,
            sortOrder: row.sortOrder,
            isActive: row.isActive,
          },
        },
      };
      await this.cache?.set(cacheKey, payload);
      return payload;
    }

    const row = await this.languages.findByCode(args.entryCode);
    if (!row) throw notFound('language', args.entryCode);
    const links = await em.find(LanguageCountry, { languageCode: row.code });
    const payload: DictionaryByCodeResponse = {
      data: {
        entryType: 'language',
        entry: {
          code: row.code,
          label: await this.labelResolver.resolveLabel({
            entryType: 'language',
            entryCode: row.code,
            locale,
          }),
          nativeLabel: row.nativeLabel || row.label,
          isRtl: row.isRtl,
          fallbackCode: row.fallbackCode ?? null,
          countries: links.map((link) => link.countryCode),
          sortOrder: row.sortOrder,
          isActive: row.isActive,
        },
      },
    };
    await this.cache?.set(cacheKey, payload);
    return payload;
  }

  private async resolveContext(args: DictionaryRegistryArgs): Promise<{
    channel: SalesChannel | null;
    locale: string;
    cacheChannelKey: string;
  }> {
    const em = this.emFactory();
    const channel = args.channelCode
      ? await em.findOne(SalesChannel, { code: args.channelCode })
      : await em.findOne(SalesChannel, { systemDefault: true });
    if (args.channelCode && !channel) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Sales channel ${args.channelCode} not found.`,
      );
    }
    const locale = args.locale ?? channel?.defaultLanguage ?? (await this.resolveDefaultLocale());
    return {
      channel: channel ?? null,
      locale,
      // Issue #101 — the key is the channel this read actually resolved, not
      // the literal `'default'` it used to be. A code is not an identity: the
      // flag moves (D-51), so an entry keyed `'default'` outlived the channel
      // it was built from and served the previous default's languages and
      // currencies under the new one's name. `__global__` is the reserved
      // segment for the platform-wide tier, the same one the settings cache
      // uses; a uuid can never spell it, so it cannot collide with a channel.
      cacheChannelKey: channel?.id ?? GLOBAL_CACHE_KEY_SEGMENT,
    };
  }

  private async resolveDefaultLocale(): Promise<string> {
    const language = await this.languages.getDefault();
    return language?.code ?? 'en-US';
  }
}

function canonical(
  entryType: DictionaryEntryType,
  entryCode: string,
  canonicalLabel: string,
): LabelBatchEntry {
  return { entryType, entryCode, canonicalLabel };
}

function groupCountryLinks(links: LanguageCountry[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const link of links) {
    const list = out.get(link.languageCode) ?? [];
    list.push(link.countryCode);
    out.set(link.languageCode, list);
  }
  for (const list of out.values()) list.sort();
  return out;
}

function notFound(entryType: DictionaryEntryType, entryCode: string): HttpError {
  return new HttpError(
    404,
    ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
    `Dictionary ${entryType} ${entryCode} not found.`,
  );
}
