import type { FastifyInstance } from 'fastify';
import {
  upsertLanguageRequestSchema,
  type CurrencyReadPort,
  type CurrencyRecord,
} from '@endora-commerce/contracts';
import type { LanguageService } from './services/language-service.js';
import type { Language } from './entities/language.entity.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

export interface I18nRoutesDeps {
  languageService: LanguageService;
  /**
   * Owned by `currencies` (feature 075, Phase C), and read by exactly one route
   * here: `GET /api/v1/i18n/config`, which answers with both catalogues and
   * their defaults in one public payload.
   *
   * The four `/api/v1/admin/currencies*` routes this module also served moved to
   * `currencies` on 2026-08-29, and with them the `currencyAdminPort`
   * resolution. That was a write surface for another module's table, gated on
   * `catalog:write`, reached by nothing in this repository — the admin currency
   * screen is `dictionaries`'. What is left is a read this endpoint composes,
   * which is what a public aggregate is for. When `currencies` is off the port
   * fails closed and this route answers 503 `MODULE_DISABLED`: a config payload
   * that guesses a currency is worse than one that refuses, and `currencies` is
   * non-deactivatable in any case.
   */
  currencyRead: CurrencyReadPort;
  requireAdmin: RequireAdminFactory;
  /** Called after any mutation so cached defaults get invalidated. */
  onConfigChange?: () => void;
}

export async function registerI18nRoutes(
  app: FastifyInstance,
  deps: I18nRoutesDeps,
): Promise<void> {
  const { languageService, currencyRead, requireAdmin, onConfigChange } = deps;

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
