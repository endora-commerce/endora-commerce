import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type DictionaryByCodeResponse,
  type DictionaryEntryType,
  type DictionaryRegistryResponse,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Currency } from '../../currencies/entities/currency.entity.js';
import { Language } from '../../languages/entities/language.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { Country } from '../entities/country.entity.js';
import { LanguageCountry } from '../entities/language-country.entity.js';
import { DictionaryCache } from './dictionary-cache.js';
import { LabelResolver } from './label-resolver.js';

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
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: DictionaryCache,
    private readonly labelResolver = new LabelResolver(emFactory),
  ) {}

  async getRegistry(args: DictionaryRegistryArgs = {}): Promise<DictionaryRegistryResponse> {
    const ctx = await this.resolveContext(args);
    const cacheKey = DictionaryCache.registryKey(ctx.cacheChannelCode, ctx.locale);
    const cached = await this.cache?.get<DictionaryRegistryResponse>(cacheKey);
    if (cached) return cached;

    const em = this.emFactory();
    const [countries, currencies, languages, links] = await Promise.all([
      em.find(Country, { isActive: true }, { orderBy: { sortOrder: 'asc', label: 'asc' } }),
      em.find(Currency, { isActive: true }, { orderBy: { sortOrder: 'asc', code: 'asc' } }),
      em.find(Language, { isActive: true }, { orderBy: { sortOrder: 'asc', code: 'asc' } }),
      em.find(LanguageCountry, {}),
    ]);

    const scopedCurrencies = ctx.channel
      ? currencies.filter((row) => ctx.channel?.currencies.includes(row.code))
      : currencies;
    const scopedLanguages = ctx.channel
      ? languages.filter((row) => ctx.channel?.languages.includes(row.code))
      : languages;

    const countryLinks = groupCountryLinks(links);
    const [resolvedCountries, resolvedCurrencies, resolvedLanguages] = await Promise.all([
      Promise.all(
        countries.map(async (row) => ({
          code: row.code,
          label: await this.labelResolver.resolveLabel({
            entryType: 'country',
            entryCode: row.code,
            locale: ctx.locale,
          }),
          alpha3Code: row.alpha3Code,
          numericCode: row.numericCode,
          region: row.region as DictionaryRegistryResponse['data']['countries'][number]['region'],
          subregion: row.subregion ?? null,
          dialCode: row.dialCode ?? null,
          isEuMember: row.isEuMember,
          defaultCurrencyCode: row.defaultCurrencyCode ?? null,
          sortOrder: row.sortOrder,
        })),
      ),
      Promise.all(
        scopedCurrencies.map(async (row) => ({
          code: row.code,
          label: await this.labelResolver.resolveLabel({
            entryType: 'currency',
            entryCode: row.code,
            locale: ctx.locale,
          }),
          symbol: row.symbol,
          symbolPosition: row.symbolPosition,
          decimalPlaces: row.decimalPlaces,
          sortOrder: row.sortOrder,
        })),
      ),
      Promise.all(
        scopedLanguages.map(async (row) => ({
          code: row.code,
          label: await this.labelResolver.resolveLabel({
            entryType: 'language',
            entryCode: row.code,
            locale: ctx.locale,
          }),
          nativeLabel: row.nativeLabel || row.label,
          isRtl: row.isRtl,
          fallbackCode: row.fallbackCode ?? null,
          countries: countryLinks.get(row.code) ?? [],
          sortOrder: row.sortOrder,
        })),
      ),
    ]);
    const payload: DictionaryRegistryResponse = {
      data: {
        countries: resolvedCountries,
        currencies: resolvedCurrencies,
        languages: resolvedLanguages,
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
      const row = await em.findOne(Currency, { code: args.entryCode });
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

    const row = await em.findOne(Language, { code: args.entryCode });
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
    cacheChannelCode: string;
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
      cacheChannelCode: args.channelCode ?? 'default',
    };
  }

  private async resolveDefaultLocale(): Promise<string> {
    const language = await this.emFactory().findOne(Language, { isDefault: true });
    return language?.code ?? 'en-US';
  }
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
