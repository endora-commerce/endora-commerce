import type { FastifyInstance } from 'fastify';
import {
  upsertLanguageRequestSchema,
  upsertCurrencyRequestSchema,
  type CurrencyAdminPort,
  type CurrencyReadPort,
  type CurrencyRecord,
} from '@b2b/contracts';
import type { LanguageService } from './services/language-service.js';
import type { Language } from './entities/language.entity.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface I18nRoutesDeps {
  languageService: LanguageService;
  /**
   * Owned by `currencies` (feature 075, Phase C). This surface serves both
   * catalogues, but only `languages` owns one of them: the currency half comes
   * over the ports `currencies` publishes, so this module names neither its
   * entity nor its service. When `currencies` is off the currency routes answer
   * 503 `MODULE_DISABLED` — a currency catalogue that guesses is worse than one
   * that refuses, and `currencies` is non-deactivatable in any case.
   */
  currencyRead: CurrencyReadPort;
  currencyAdmin: CurrencyAdminPort;
  requireAdmin: RequireAdminFactory;
  /** Called after any mutation so cached defaults get invalidated. */
  onConfigChange?: () => void;
}

export async function registerI18nRoutes(
  app: FastifyInstance,
  deps: I18nRoutesDeps,
): Promise<void> {
  const { languageService, currencyRead, currencyAdmin, requireAdmin, onConfigChange } = deps;

  // ---- Public (storefront + admin) i18n config ----
  app.get('/api/v1/i18n/config', async () => {
    const [languages, currencies, defaultLanguage, defaultCurrency] = await Promise.all([
      languageService.listActive(),
      currencyRead.listActive(),
      languageService.getDefault(),
      currencyRead.getDefault(),
    ]);
    return {
      data: {
        languages: languages.map(serializeLanguage),
        currencies: currencies.map(serializeCurrency),
        defaultLanguageCode: defaultLanguage?.code ?? null,
        defaultCurrencyCode: defaultCurrency?.code ?? null,
      },
    };
  });

  // ---- Admin: languages ----
  app.get(
    '/api/v1/admin/languages',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await languageService.list();
      return { data: rows.map(serializeLanguage) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/languages/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertLanguageRequestSchema },
    },
    async (request) => {
      const body = upsertLanguageRequestSchema.parse(request.body);
      const row = await languageService.upsert({
        code: request.params.code,
        label: body.label,
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      });
      onConfigChange?.();
      return { data: serializeLanguage(row) };
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/languages/:code/default',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await languageService.setDefault(request.params.code);
      onConfigChange?.();
      return { data: serializeLanguage(row) };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/languages/:code',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await languageService.remove(request.params.code);
      onConfigChange?.();
      return reply.status(204).send();
    },
  );

  // ---- Admin: currencies ----
  app.get(
    '/api/v1/admin/currencies',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await currencyRead.list();
      return { data: rows.map(serializeCurrency) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/currencies/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertCurrencyRequestSchema },
    },
    async (request) => {
      const body = upsertCurrencyRequestSchema.parse(request.body);
      const row = await currencyAdmin.upsert({
        code: request.params.code,
        label: body.label,
        symbol: body.symbol,
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      });
      onConfigChange?.();
      return { data: serializeCurrency(row) };
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/currencies/:code/default',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await currencyAdmin.setDefault(request.params.code);
      onConfigChange?.();
      return { data: serializeCurrency(row) };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/currencies/:code',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await currencyAdmin.remove(request.params.code);
      onConfigChange?.();
      return reply.status(204).send();
    },
  );
}

function serializeLanguage(l: Language): Record<string, unknown> {
  return {
    code: l.code,
    label: l.label,
    isDefault: l.isDefault,
    isActive: l.isActive,
    sortOrder: l.sortOrder,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

function serializeCurrency(c: CurrencyRecord): Record<string, unknown> {
  return {
    code: c.code,
    label: c.label,
    symbol: c.symbol,
    isDefault: c.isDefault,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
