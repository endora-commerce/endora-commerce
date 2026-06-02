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
} from '@b2b/contracts';
import type { RequireAdminFactory } from './plugin.js';
import { DICTIONARY_PERMISSIONS } from './manifest.js';
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
import type { LanguageService } from '../languages/services/language-service.js';
import type { CurrencyService } from '../currencies/services/currency-service.js';
import type { Language } from '../languages/entities/language.entity.js';
import type { Currency } from '../currencies/entities/currency.entity.js';

export interface DictionaryAdminRoutesDeps {
  emFactory: () => EntityManager;
  countryService: CountryService;
  currencyService: CurrencyService;
  languageService: LanguageService;
  languageCountryService: LanguageCountryService;
  translationService: TranslationService;
  invalidateDictionaryState: () => Promise<void>;
  requireAdmin: RequireAdminFactory;
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
    const rows = await scanDictionaryOrphans(deps.emFactory());
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
      reply.status(204).send();
    },
  );

  app.get('/api/v1/admin/dictionary/currencies', { preHandler: gate }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    return pageAndFilter(
      (await deps.currencyService.list()).map(serializeCurrency),
      query,
      ['code', 'label'],
    );
  });

  app.post(
    '/api/v1/admin/dictionary/currencies',
    { preHandler: gate, schema: { body: createDictionaryCurrencyRequestSchema } },
    async (request, reply) => {
      const body = createDictionaryCurrencyRequestSchema.parse(request.body);
      const row = await deps.currencyService.create(
        compact(body) as Parameters<CurrencyService['create']>[0],
      );
      reply.status(201);
      return { data: serializeCurrency(row) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/currencies/:code',
    { preHandler: gate, schema: { body: updateDictionaryCurrencyRequestSchema } },
    async (request) => {
      const body = updateDictionaryCurrencyRequestSchema.parse(request.body);
      const row = await deps.currencyService.update(
        request.params.code,
        compact(body) as Parameters<CurrencyService['update']>[1],
      );
      return { data: serializeCurrency(row) };
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/currencies/:code/default',
    { preHandler: gate },
    async (request) => {
      const row = await deps.currencyService.setDefault(request.params.code);
      return { data: serializeCurrency(row) };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/dictionary/currencies/:code',
    { preHandler: gate },
    async (request, reply) => {
      await deps.currencyService.remove(request.params.code);
      reply.status(204).send();
    },
  );

  app.get('/api/v1/admin/dictionary/languages', { preHandler: gate }, async (request) => {
    const query = pageQuerySchema.parse(request.query);
    const rows = await withLanguageCountries(
      deps.languageService,
      deps.languageCountryService,
    );
    return pageAndFilter(rows, query, ['code', 'label', 'nativeLabel']);
  });

  app.post(
    '/api/v1/admin/dictionary/languages',
    { preHandler: gate, schema: { body: createDictionaryLanguageRequestSchema } },
    async (request, reply) => {
      const body = createDictionaryLanguageRequestSchema.parse(request.body);
      const row = await deps.languageService.create(
        compact(body) as Parameters<LanguageService['create']>[0],
      );
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
      const row = await deps.languageService.update(
        request.params.code,
        compact(body) as Parameters<LanguageService['update']>[1],
      );
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
      const row = await deps.languageService.setDefault(request.params.code);
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
      await deps.languageService.remove(request.params.code);
      reply.status(204).send();
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
      reply.status(204).send();
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
      reply.status(204).send();
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

async function scanDictionaryOrphans(em: EntityManager): Promise<DictionaryOrphanRow[]> {
  const conn = em.getConnection();
  const queries = [
    `select 'country' as dictionary, 'addresses' as consumer, 'addresses' as table_name,
            'country' as column_name, a.country as code, count(*)::int as count
       from addresses a
       left join countries c on c.code = a.country
      where a.country is not null and c.code is null
      group by a.country`,
    `select 'country' as dictionary, 'organizations' as consumer, 'organizations' as table_name,
            'registered_address.country' as column_name, o.registered_address->>'country' as code,
            count(*)::int as count
       from organizations o
       left join countries c on c.code = o.registered_address->>'country'
      where o.registered_address->>'country' is not null and c.code is null
      group by o.registered_address->>'country'`,
    `select 'country' as dictionary, 'warehouses' as consumer, 'warehouses' as table_name,
            'address.countryCode' as column_name, w.address->>'countryCode' as code,
            count(*)::int as count
       from warehouses w
       left join countries c on c.code = w.address->>'countryCode'
      where w.address->>'countryCode' is not null and c.code is null
      group by w.address->>'countryCode'`,
    `select 'country' as dictionary, 'taxes' as consumer, 'taxes' as table_name,
            'country' as column_name, t.country as code, count(*)::int as count
       from taxes t
       left join countries c on c.code = t.country
      where t.country is not null and c.code is null
      group by t.country`,
    `select 'currency' as dictionary, 'sales_channels' as consumer, 'sales_channels' as table_name,
            'default_currency' as column_name, s.default_currency as code, count(*)::int as count
       from sales_channels s
       left join currencies c on c.code = s.default_currency
      where s.default_currency is not null and c.code is null
      group by s.default_currency`,
    `select 'currency' as dictionary, 'sales_channels' as consumer, 'sales_channels' as table_name,
            'currencies[]' as column_name, value.code as code, count(*)::int as count
       from sales_channels s
       cross join lateral jsonb_array_elements_text(coalesce(s.currencies, '[]'::jsonb)) as value(code)
       left join currencies c on c.code = value.code
      where c.code is null
      group by value.code`,
    `select 'currency' as dictionary, 'promotions' as consumer, 'promotions' as table_name,
            'currency' as column_name, p.currency as code, count(*)::int as count
       from promotions p
       left join currencies c on c.code = p.currency
      where p.currency is not null and c.code is null
      group by p.currency`,
    `select 'language' as dictionary, 'sales_channels' as consumer, 'sales_channels' as table_name,
            'default_language' as column_name, s.default_language as code, count(*)::int as count
       from sales_channels s
       left join languages l on l.code = s.default_language
      where s.default_language is not null and l.code is null
      group by s.default_language`,
    `select 'language' as dictionary, 'sales_channels' as consumer, 'sales_channels' as table_name,
            'languages[]' as column_name, value.code as code, count(*)::int as count
       from sales_channels s
       cross join lateral jsonb_array_elements_text(coalesce(s.languages, '[]'::jsonb)) as value(code)
       left join languages l on l.code = value.code
      where l.code is null
      group by value.code`,
    `select 'language' as dictionary, 'megamenu' as consumer, 'megamenu_bindings' as table_name,
            'language' as column_name, b.language as code, count(*)::int as count
       from megamenu_bindings b
       left join languages l on l.code = b.language
      where b.language is not null and l.code is null
      group by b.language`,
    `select 'language' as dictionary, 'blog' as consumer, 'blog_post_languages' as table_name,
            'language' as column_name, b.language as code, count(*)::int as count
       from blog_post_languages b
       left join languages l on l.code = b.language
      where b.language is not null and l.code is null
      group by b.language`,
    `select 'language' as dictionary, 'blog' as consumer, 'blog_category_languages' as table_name,
            'language' as column_name, b.language as code, count(*)::int as count
       from blog_category_languages b
       left join languages l on l.code = b.language
      where b.language is not null and l.code is null
      group by b.language`,
  ];
  const rows: DictionaryOrphanRow[] = [];
  for (const sql of queries) {
    const result = (await conn.execute(sql)) as Array<{
      dictionary: DictionaryOrphanRow['dictionary'];
      consumer: string;
      table_name: string;
      column_name: string;
      code: string;
      count: number | string;
    }>;
    rows.push(
      ...result.map((row) => ({
        dictionary: row.dictionary,
        consumer: row.consumer,
        tableName: row.table_name,
        columnName: row.column_name,
        code: row.code,
        count: Number(row.count),
      })),
    );
  }
  return rows.sort((a, b) =>
    `${a.dictionary}:${a.consumer}:${a.tableName}:${a.columnName}:${a.code}`.localeCompare(
      `${b.dictionary}:${b.consumer}:${b.tableName}:${b.columnName}:${b.code}`,
    ),
  );
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
  languageService: LanguageService,
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

function serializeCurrency(row: Currency): Record<string, unknown> {
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

function serializeLanguage(row: Language, countries: string[]): Record<string, unknown> {
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
