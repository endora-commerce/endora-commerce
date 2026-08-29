import type { FastifyInstance } from 'fastify';
import {
  upsertCurrencyRequestSchema,
  type CurrencyAdminPort,
  type CurrencyReadPort,
  type CurrencyRecord,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * The currency catalogue's own admin surface (2026-08-29).
 *
 * These four routes were registered by `languages` until this change, over the
 * two ports this module publishes. Nothing about that arrangement was an
 * accident of the screen they serve: the admin currency screen is
 * `dictionaries`' (`/api/v1/admin/dictionary/currencies`), and no caller in
 * this repository ever reached the four routes below. So `languages` hosted
 * another module's write surface for no reason that survives being written
 * down, and it hosted it on `catalog:write` — the code a merchandiser holds to
 * edit a product description, which therefore also promoted a currency to the
 * shop's default.
 *
 * Two things follow from the move and are the point of it. The authority is
 * this module's own pair, `currencies:read` / `currencies:write`. And the
 * module-presence gate is now the **registration** seam (`ctx.routes`), which
 * is what Constitution XVII item 1 asks for — the hand-written "these answer
 * 503 `MODULE_DISABLED` because the ports fail closed" note the old deps block
 * carried was a rule an author had to remember, and it is now structural.
 * `currencies` declares `activation.nonDeactivatable`, so today the gate can
 * never bite; that is exactly why it should not rest on anybody's memory.
 *
 * `GET /api/v1/i18n/config` stays with `languages`: it answers with both
 * catalogues at once and is a public read, so it is composition rather than
 * ownership. `languages` keeps `currencyReadPort` for it and nothing else.
 */
export interface CurrencyAdminRoutesDeps {
  currencyRead: CurrencyReadPort;
  currencyAdmin: CurrencyAdminPort;
  requireAdmin: RequireAdminFactory;
}

export async function registerCurrencyRoutes(
  app: FastifyInstance,
  deps: CurrencyAdminRoutesDeps,
): Promise<void> {
  const { currencyRead, currencyAdmin, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/currencies',
    { preHandler: requireAdmin('currencies:read') },
    async () => {
      const rows = await currencyRead.list();
      return { data: rows.map(serializeCurrency) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/currencies/:code',
    {
      preHandler: requireAdmin('currencies:write'),
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
      return { data: serializeCurrency(row) };
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/currencies/:code/default',
    { preHandler: requireAdmin('currencies:write') },
    async (request) => {
      const row = await currencyAdmin.setDefault(request.params.code);
      return { data: serializeCurrency(row) };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/currencies/:code',
    { preHandler: requireAdmin('currencies:write') },
    async (request, reply) => {
      await currencyAdmin.remove(request.params.code);
      return reply.status(204).send();
    },
  );
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
