import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  createCountryRequestSchema,
  createDictionaryCurrencyRequestSchema,
  createDictionaryLanguageRequestSchema,
  dictionaryEntryTypeSchema,
  updateCountryRequestSchema,
  updateDictionaryCurrencyRequestSchema,
  updateDictionaryLanguageRequestSchema,
  upsertTranslationRequestSchema,
  upsertLanguageCountryRequestSchema,
  type CreateCurrencyInput,
  type CreateLanguageInput,
  type CurrencyAdminPort,
  type CurrencyReadPort,
  type CurrencyRecord,
  type DictionaryReferenceRegistryPort,
  type LanguageAdminPort,
  type LanguageReadPort,
  type LanguageRecord,
  type UpdateCurrencyInput,
  type UpdateLanguageInput,
} from '@endora-commerce/contracts';
import { DICTIONARY_PERMISSIONS } from '../manifest.js';
import type {
  CountryService} from './services/country-service.js';
import {
  type CreateCountryInput,
  type UpdateCountryInput,
} from './services/country-service.js';
import type { LanguageCountryService } from './services/language-country-service.js';
import type { Country } from './entities/country.entity.js';
import type { DictionaryTranslation } from './entities/dictionary-translation.entity.js';
import type { LanguageCountry } from './entities/language-country.entity.js';
import type { TranslationService } from './services/translation-service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 075, Phase C — this module hosts the admin screen for two tables it
 * does not own, which is why the write side crosses a boundary by design
 * (`languages.ts` and `currencies.ts` both say so). It used to cross by holding
 * the owners' service classes and serialising their entities; it now holds the
 * four published ports and serialises the records they return, so the screen
 * refuses while an owner is switched off instead of editing rows nobody is
 * serving.
 */
export interface DictionaryAdminRoutesDeps {
  emFactory: () => EntityManager;
  countryService: CountryService;
  currencyRead: CurrencyReadPort;
  currencyAdmin: CurrencyAdminPort;
  languageRead: LanguageReadPort;
  languageAdmin: LanguageAdminPort;
  languageCountryService: LanguageCountryService;
  translationService: TranslationService;
  invalidateDictionaryState: () => Promise<void>;
  requireAdmin: RequireAdminFactory;
  /**
   * One reference registry per dictionary, each owned by the module that owns
   * the table being pointed at (feature 077, D-87). The orphan report is the
   * one caller that needs all three: it asks each consumer which codes it
   * stores and subtracts the codes the dictionary really has.
   */
  countryReferences: DictionaryReferenceRegistryPort;
  currencyReferences: DictionaryReferenceRegistryPort;
  languageReferences: DictionaryReferenceRegistryPort;
}

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(250).default(50),
  sort: z.enum(['sortOrder', 'label', 'code', 'region']).default('sortOrder'),
  search: z.string().trim().optional(),
});

export async function registerDictionaryAdminRoutes(
  app: FastifyInstance,
  deps: DictionaryAdminRoutesDeps,
): Promise<void> {
  const gate = deps.requireAdmin(DICTIONARY_PERMISSIONS.WRITE);

  app.get('/api/v1/admin/dictionary/audit/orphans', { preHandler: gate }, async () => {
    const rows = await scanDictionaryOrphans(deps);
    return {
      data: rows,
      meta: {
        generatedAt: new Date().toISOString(),
        total: rows.reduce((sum, row) => sum + row.count, 0),
      },
    };
  });

  app.post('/api/v1/admin/dictionary/cache/invalidate', { preHandler: gate }, async () => {
    await deps.invalidateDictionaryState();
    return { data: { invalidated: true, invalidatedAt: new Date().toISOString() } };
  });

  app.get('/api/v1/admin/dictionary/countries', { preHandler: gate }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const rows = pageAndFilter(
      (await deps.countryService.list()).map(serializeCountry),
      query,
      ['code', 'label', 'alpha3Code'],
    );
    return rows;
  });

  app.post(
    '/api/v1/admin/dictionary/countries',
    { preHandler: gate, schema: { body: createCountryRequestSchema } },
    async (request, reply) => {
      const body = createCountryRequestSchema.parse(request.body);
      const row = await deps.countryService.create(compact(body) as CreateCountryInput);
      reply.status(201);
      return { data: serializeCountry(row) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/countries/:code',
    { preHandler: gate, schema: { body: updateCountryRequestSchema } },
    async (request) => {
      const body = updateCountryRequestSchema.parse(request.body);
      const row = await deps.countryService.update(
        request.params.code,
        compact(body) as UpdateCountryInput,
      );
      return { data: serializeCountry(row) };
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/countries/:code/default',
    { preHandler: gate },
    async (request) => {
      const row = await deps.countryService.setDefault(request.params.code);
      return { data: serializeCountry(row) };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/countries/:code',
    { preHandler: gate },
    async (request, reply) => {
      await deps.countryService.remove(request.params.code);
      return reply.status(204).send();
    },
  );

  app.get('/api/v1/admin/dictionary/currencies', { preHandler: gate }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    return pageAndFilter(
      (await deps.currencyRead.list()).map(serializeCurrency),
      query,
      ['code', 'label'],
    );
  });

  app.post(
    '/api/v1/admin/dictionary/currencies',
    { preHandler: gate, schema: { body: createDictionaryCurrencyRequestSchema } },
    async (request, reply) => {
      const body = createDictionaryCurrencyRequestSchema.parse(request.body);
      const row = await deps.currencyAdmin.create(compact(body) as CreateCurrencyInput);
      reply.status(201);
      return { data: serializeCurrency(row) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/currencies/:code',
    { preHandler: gate, schema: { body: updateDictionaryCurrencyRequestSchema } },
    async (request) => {
      const body = updateDictionaryCurrencyRequestSchema.parse(request.body);
      const row = await deps.currencyAdmin.update(request.params.code, compact(body) as UpdateCurrencyInput);
      return { data: serializeCurrency(row) };
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/currencies/:code/default',
    { preHandler: gate },
    async (request) => {
      const row = await deps.currencyAdmin.setDefault(request.params.code);
      return { data: serializeCurrency(row) };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/currencies/:code',
    { preHandler: gate },
    async (request, reply) => {
      await deps.currencyAdmin.remove(request.params.code);
      return reply.status(204).send();
    },
  );

  app.get('/api/v1/admin/dictionary/languages', { preHandler: gate }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const rows = await withLanguageCountries(
      deps.languageRead,
      deps.languageCountryService,
    );
    return pageAndFilter(rows, query, ['code', 'label', 'nativeLabel']);
  });

  app.post(
    '/api/v1/admin/dictionary/languages',
    { preHandler: gate, schema: { body: createDictionaryLanguageRequestSchema } },
    async (request, reply) => {
      const body = createDictionaryLanguageRequestSchema.parse(request.body);
      const row = await deps.languageAdmin.create(compact(body) as CreateLanguageInput);
      reply.status(201);
      return {
        data: serializeLanguage(row, []),
      };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/languages/:code',
    { preHandler: gate, schema: { body: updateDictionaryLanguageRequestSchema } },
    async (request) => {
      const body = updateDictionaryLanguageRequestSchema.parse(request.body);
      const row = await deps.languageAdmin.update(request.params.code, compact(body) as UpdateLanguageInput);
      const countries = (await deps.languageCountryService.listForLanguage(row.code)).map(
        (lc) => lc.countryCode,
      );
      return { data: serializeLanguage(row, countries) };
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/languages/:code/default',
    { preHandler: gate },
    async (request) => {
      const row = await deps.languageAdmin.setDefault(request.params.code);
      const countries = (await deps.languageCountryService.listForLanguage(row.code)).map(
        (lc) => lc.countryCode,
      );
      return { data: serializeLanguage(row, countries) };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/languages/:code',
    { preHandler: gate },
    async (request, reply) => {
      await deps.languageAdmin.remove(request.params.code);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { entryType: string; entryCode: string } }>(
    '/api/v1/admin/dictionary/translations/:entryType/:entryCode',
    { preHandler: gate },
    async (request) => {
      const entryType = dictionaryEntryTypeSchema.parse(request.params.entryType);
      const rows = await deps.translationService.listForEntry(
        entryType,
        request.params.entryCode,
      );
      return { data: rows.map(serializeTranslation) };
    },
  );

  app.put<{ Params: { entryType: string; entryCode: string; languageCode: string } }>(
    '/api/v1/admin/dictionary/translations/:entryType/:entryCode/:languageCode',
    { preHandler: gate, schema: { body: upsertTranslationRequestSchema } },
    async (request) => {
      const entryType = dictionaryEntryTypeSchema.parse(request.params.entryType);
      const body = upsertTranslationRequestSchema.parse(request.body);
      const row = await deps.translationService.upsert({
        entryType,
        entryCode: request.params.entryCode,
        languageCode: request.params.languageCode,
        label: body.label,
      });
      return { data: serializeTranslation(row) };
    },
  );

  app.delete<{ Params: { entryType: string; entryCode: string; languageCode: string } }>(
    '/api/v1/admin/dictionary/translations/:entryType/:entryCode/:languageCode',
    { preHandler: gate },
    async (request, reply) => {
      const entryType = dictionaryEntryTypeSchema.parse(request.params.entryType);
      await deps.translationService.remove(
        entryType,
        request.params.entryCode,
        request.params.languageCode,
      );
      return reply.status(204).send();
    },
  );

  app.put<{ Params: { languageCode: string; countryCode: string } }>(
    '/api/v1/admin/dictionary/languages/:languageCode/countries/:countryCode',
    { preHandler: gate, schema: { body: upsertLanguageCountryRequestSchema } },
    async (request) => {
      const body = upsertLanguageCountryRequestSchema.parse(request.body);
      const row = await deps.languageCountryService.upsert(
        compact({
          languageCode: request.params.languageCode,
          countryCode: request.params.countryCode,
          ...body,
        }) as Parameters<LanguageCountryService['upsert']>[0],
      );
      return { data: serializeLanguageCountry(row) };
    },
  );

  app.delete<{ Params: { languageCode: string; countryCode: string } }>(
    '/api/v1/admin/dictionary/languages/:languageCode/countries/:countryCode',
    { preHandler: gate },
    async (request, reply) => {
      await deps.languageCountryService.remove(
        request.params.languageCode,
        request.params.countryCode,
      );
      return reply.status(204).send();
    },
  );
}

type DictionaryOrphanRow = {
  dictionary: 'country' | 'currency' | 'language';
  consumer: string;
  tableName: string;
  columnName: string;
  code: string;
  count: number;
};

/**
 * Which stored dictionary codes no longer exist (feature 017 FR-022), rebuilt
 * on the reference registries (feature 077, D-87).
 *
 * It used to be twelve hand-written `left join` statements naming eleven tables
 * across nine modules — `addresses`, `organizations`, `warehouses`, `taxes`,
 * `promotions`, `megamenu_bindings`, `blog_post_languages`,
 * `blog_category_languages`, plus `currencies` and `languages` on the other side
 * of each join. Every one of them named a table this module does not own, in a
 * string no import-level boundary check can see, and every one of them had to be
 * edited here whenever a module started storing a code.
 *
 * The question splits in two, and only the first half was ever this module's:
 * *which codes does each consumer store* is the consumer's own table, so each
 * consumer answers it through the descriptor it contributes; *which codes exist*
 * is the dictionary owner's, so it comes from this module's `countries` and from
 * `languages`' and `currencies`' read ports. A code in the first set and not in
 * the second is a dangler.
 *
 * The kernel's `sales_channels` is the one consumer with no descriptor: it is
 * not a module, so nobody can contribute for it. This module reads it through
 * the ORM instead, which is allowed — a module may relate into the kernel (D-32)
 * — and counts in memory because a deployment has tens of channels and both
 * dictionary questions are about the same rows.
 */
async function scanDictionaryOrphans(
  deps: DictionaryAdminRoutesDeps,
): Promise<DictionaryOrphanRow[]> {
  const em = deps.emFactory();
  const [countryRows, currencies, languages, channels] = await Promise.all([
    em.execute(`select "code" from "countries"`) as Promise<Array<{ code: string }>>,
    deps.currencyRead.list(),
    deps.languageRead.list(),
    em.find(SalesChannel, {}),
  ]);
  const known: Record<DictionaryOrphanRow['dictionary'], Set<string>> = {
    country: new Set(countryRows.map((row) => row.code)),
    currency: new Set(currencies.map((row) => row.code)),
    language: new Set(languages.map((row) => row.code)),
  };

  const rows: DictionaryOrphanRow[] = [];
  const add = (
    dictionary: DictionaryOrphanRow['dictionary'],
    consumer: string,
    tableName: string,
    columnName: string,
    code: string,
    count: number,
  ): void => {
    if (count === 0) return;
    if (known[dictionary].has(code)) return;
    rows.push({ dictionary, consumer, tableName, columnName, code, count });
  };

  const registries: ReadonlyArray<
    [DictionaryOrphanRow['dictionary'], DictionaryReferenceRegistryPort]
  > = [
    ['country', deps.countryReferences],
    ['currency', deps.currencyReferences],
    ['language', deps.languageReferences],
  ];
  for (const [dictionary, registry] of registries) {
    for (const reference of await registry.usedCodes()) {
      add(
        dictionary,
        reference.consumer,
        reference.tableName,
        reference.columnName,
        reference.code,
        reference.count,
      );
    }
  }

  for (const [dictionary, singular, plural] of [
    ['currency', 'defaultCurrency', 'currencies'],
    ['language', 'defaultLanguage', 'languages'],
  ] as const) {
    const column = singular === 'defaultCurrency' ? 'default_currency' : 'default_language';
    const singleCounts = tally(channels.map((channel) => channel[singular]));
    for (const [code, count] of singleCounts) {
      add(dictionary, 'sales_channels', 'sales_channels', column, code, count);
    }
    const listCounts = tally(channels.flatMap((channel) => channel[plural]));
    for (const [code, count] of listCounts) {
      add(dictionary, 'sales_channels', 'sales_channels', `${plural}[]`, code, count);
    }
  }

  return rows.sort((a, b) =>
    `${a.dictionary}:${a.consumer}:${a.tableName}:${a.columnName}:${a.code}`.localeCompare(
      `${b.dictionary}:${b.consumer}:${b.tableName}:${b.columnName}:${b.code}`,
    ),
  );
}

/** How many times each non-empty code appears. */
function tally(codes: ReadonlyArray<string | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const code of codes) {
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

function pageAndFilter<T extends Record<string, unknown>>(
  rows: T[],
  query: z.infer<typeof pageQuerySchema>,
  searchKeys: Array<keyof T>,
): { data: T[]; pagination: { page: number; pageSize: number; total: number } } {
  const needle = query.search?.toLowerCase();
  const filtered = needle
    ? rows.filter((row) =>
        searchKeys.some((key) => String(row[key] ?? '').toLowerCase().includes(needle)),
      )
    : rows;
  const sorted = [...filtered].sort((a, b) => compareBySort(a, b, query.sort));
  const start = (query.page - 1) * query.pageSize;
  return {
    data: sorted.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length },
  };
}

function compareBySort(a: Record<string, unknown>, b: Record<string, unknown>, sort: string): number {
  const primary =
    sort === 'sortOrder'
      ? Number(a['sortOrder'] ?? 0) - Number(b['sortOrder'] ?? 0)
      : String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''));
  if (primary !== 0) return primary;
  return String(a['label'] ?? a['code'] ?? '').localeCompare(String(b['label'] ?? b['code'] ?? ''));
}

async function withLanguageCountries(
  languageService: LanguageReadPort,
  languageCountryService: LanguageCountryService,
): Promise<Array<ReturnType<typeof serializeLanguage>>> {
  const languages = await languageService.list();
  const out = [];
  for (const language of languages) {
    const countries = (await languageCountryService.listForLanguage(language.code)).map(
      (lc) => lc.countryCode,
    );
    out.push(serializeLanguage(language, countries));
  }
  return out;
}

function serializeCountry(row: Country): Record<string, unknown> {
  return {
    code: row.code,
    alpha3Code: row.alpha3Code,
    numericCode: row.numericCode,
    label: row.label,
    region: row.region,
    subregion: row.subregion ?? null,
    dialCode: row.dialCode ?? null,
    isEuMember: row.isEuMember,
    defaultCurrencyCode: row.defaultCurrencyCode ?? null,
    isActive: row.isActive,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeCurrency(row: CurrencyRecord): Record<string, unknown> {
  return {
    code: row.code,
    label: row.label,
    symbol: row.symbol,
    symbolPosition: row.symbolPosition,
    decimalPlaces: row.decimalPlaces,
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeLanguage(row: LanguageRecord, countries: string[]): Record<string, unknown> {
  return {
    code: row.code,
    label: row.label,
    nativeLabel: row.nativeLabel,
    isRtl: row.isRtl,
    fallbackCode: row.fallbackCode ?? null,
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    countries,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeLanguageCountry(row: LanguageCountry): Record<string, unknown> {
  return {
    languageCode: row.languageCode,
    countryCode: row.countryCode,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeTranslation(row: DictionaryTranslation): Record<string, unknown> {
  return {
    entryType: row.entryType,
    entryCode: row.entryCode,
    languageCode: row.languageCode,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
