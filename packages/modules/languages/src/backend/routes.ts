import type { FastifyInstance } from 'fastify';
import {
  upsertLanguageRequestSchema,
  type Currency,
  type CurrencyReadPort,
  type CurrencyRecord,
  type I18nConfigResponse,
  type Language as LanguageView,
  type LanguageListResponse,
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
  // Feature 154 — reachable whatever the sales-channel access rule decides: the
  // sign-in pages of both UIs read the languages before anybody is signed in.
  app.get('/api/v1/i18n/config', { config: { salesChannelAccess: 'open' } }, async (): Promise<{ data: I18nConfigResponse }> => {
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
    async (): Promise<LanguageListResponse> => {
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
    async (request): Promise<{ data: LanguageView }> => {
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
    async (request): Promise<{ data: LanguageView }> => {
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

/** The published `languageSchema` (issue #599). */
function serializeLanguage(l: Language): LanguageView {
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

/** The published `currencySchema` (issue #599). */
function serializeCurrency(c: CurrencyRecord): Currency {
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
