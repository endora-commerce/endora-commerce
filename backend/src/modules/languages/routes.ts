import type { FastifyInstance } from 'fastify';
import {
  upsertLanguageRequestSchema,
  upsertCurrencyRequestSchema,
} from '@b2b/contracts';
import type { LanguageService } from './services/language-service.js';
import type { CurrencyService } from '../currencies/services/currency-service.js';
import type { Language } from './entities/language.entity.js';
import type { Currency } from '../currencies/entities/currency.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface I18nRoutesDeps {
  languageService: LanguageService;
  currencyService: CurrencyService;
  requireAdmin: RequireAdminFactory;
  /** Called after any mutation so cached defaults get invalidated. */
  onConfigChange?: () => void;
}

export async function registerI18nRoutes(
  app: FastifyInstance,
  deps: I18nRoutesDeps,
): Promise<void> {
  const { languageService, currencyService, requireAdmin, onConfigChange } = deps;

  // ---- Public (storefront + admin) i18n config ----
  app.get('/api/v1/i18n/config', async () => {
    const [languages, currencies, defaultLanguage, defaultCurrency] = await Promise.all([
      languageService.listActive(),
      currencyService.listActive(),
      languageService.getDefault(),
      currencyService.getDefault(),
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
      reply.status(204).send();
    },
  );

  // ---- Admin: currencies ----
  app.get(
    '/api/v1/admin/currencies',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await currencyService.list();
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
      const row = await currencyService.upsert({
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
      const row = await currencyService.setDefault(request.params.code);
      onConfigChange?.();
      return { data: serializeCurrency(row) };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/currencies/:code',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await currencyService.remove(request.params.code);
      onConfigChange?.();
      reply.status(204).send();
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

function serializeCurrency(c: Currency): Record<string, unknown> {
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
