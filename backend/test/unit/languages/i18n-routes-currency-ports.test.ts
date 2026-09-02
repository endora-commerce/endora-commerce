import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import type { CurrencyReadPort, CurrencyRecord } from '@endora-commerce/contracts';
import {
  registerI18nRoutes,
  type I18nRoutesDeps,
} from '../../../../packages/modules/languages/src/backend/routes.js';

/**
 * Feature 075, Phase C — `languages` asks `currencies` over its published
 * ports (FR-010, FR-012).
 *
 * `GET /api/v1/i18n/config` answers with both catalogues, so it needs currency
 * data it does not own. It used to take `CurrencyService` — the class, imported
 * across the module boundary — which meant the currency half of this route kept
 * answering out of `currencies`' tables whatever state `currencies` was in, and
 * made `languages` uncompilable without it.
 *
 * The assertion is deliberately about the **shape the routes accept**: a stub
 * implementing only `CurrencyReadPort` — no entity, no service class, nothing
 * `currencies` has not published — must be enough. A stub that is enough is a
 * boundary that is real.
 *
 * **The write half of this file moved on 2026-08-29**, with the four
 * `/api/v1/admin/currencies*` routes it covered, to
 * `test/unit/currencies/currency-routes-ports.test.ts`. `languages` was serving
 * another module's admin write surface — on `catalog:write`, for no caller in
 * this repository — and what is left here is the one read a public aggregate
 * composes.
 */

function record(overrides: Partial<CurrencyRecord> = {}): CurrencyRecord {
  return {
    code: 'XAA',
    label: 'Probe currency',
    symbol: 'X',
    symbolPosition: 'prefix',
    decimalPlaces: 2,
    isDefault: false,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const currencyRead: CurrencyReadPort = {
    list: async () => [record({ isDefault: true })],
    listActive: async () => [record({ isDefault: true })],
    getDefault: async () => record({ isDefault: true }),
    findByCode: async (code) => (code === 'XAA' ? record() : null),
  };

  const languageService = {
    list: async () => [],
    listActive: async () => [],
    getDefault: async () => null,
  } as unknown as I18nRoutesDeps['languageService'];

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerI18nRoutes(app, {
    languageService,
    currencyRead,
    requireAdmin: () => async () => undefined,
  });
  await app.ready();
  return app;
}

describe('languages i18n routes — currency data comes from the published read port', () => {
  it('serves the public i18n config from the currency read port alone', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/i18n/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { currencies: Array<{ code: string }>; defaultCurrencyCode: string | null };
    };
    expect(body.data.currencies.map((c) => c.code)).toEqual(['XAA']);
    expect(body.data.defaultCurrencyCode).toBe('XAA');
    await app.close();
  });

  /**
   * The move, asserted where it can be seen rather than left to a commit
   * message: this module registers no currency admin route any more, so a
   * `languages` app built with no currency **admin** port at all serves none.
   * Without this the four routes could quietly come back — the deps object no
   * longer names the port, but nothing else here would notice a new
   * registration.
   */
  it('registers no currency admin route of its own', async () => {
    const app = await buildApp();
    for (const [method, url] of [
      ['GET', '/api/v1/admin/currencies'],
      ['PUT', '/api/v1/admin/currencies/XAA'],
      ['POST', '/api/v1/admin/currencies/XAA/default'],
      ['DELETE', '/api/v1/admin/currencies/XAA'],
    ] as const) {
      const res = await app.inject({ method, url, payload: { label: 'x', symbol: 'X' } });
      expect(res.statusCode, `${method} ${url} is no longer this module's`).toBe(404);
    }
    await app.close();
  });
});
