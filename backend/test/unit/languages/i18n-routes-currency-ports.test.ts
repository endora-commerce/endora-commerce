import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import type {
  CurrencyAdminPort,
  CurrencyReadPort,
  CurrencyRecord,
} from '@endora-commerce/contracts';
import {
  registerI18nRoutes,
  type I18nRoutesDeps,
} from '../../../../packages/modules/languages/src/backend/routes.js';

/**
 * Feature 075, Phase C — `languages` asks `currencies` over its published
 * ports (FR-010, FR-012).
 *
 * The i18n route surface serves both catalogues, so it needs currency data it
 * does not own. It used to take `CurrencyService` — the class, imported across
 * the module boundary — which meant the currency half of these routes kept
 * answering out of `currencies`' tables whatever state `currencies` was in,
 * and made `languages` uncompilable without it.
 *
 * The assertion is deliberately about the **shape the routes accept**: a stub
 * implementing only `CurrencyReadPort` and `CurrencyAdminPort` — no entity, no
 * service class, nothing `currencies` has not published — must be enough to
 * serve every currency route. A stub that is enough is a boundary that is
 * real.
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

interface Calls {
  readonly upsert: unknown[];
  readonly setDefault: string[];
  readonly remove: string[];
}

async function buildApp(): Promise<{ app: FastifyInstance; calls: Calls }> {
  const calls: Calls = { upsert: [], setDefault: [], remove: [] };
  const currencyRead: CurrencyReadPort = {
    list: async () => [record({ isDefault: true })],
    listActive: async () => [record({ isDefault: true })],
    getDefault: async () => record({ isDefault: true }),
    findByCode: async (code) => (code === 'XAA' ? record() : null),
  };
  const currencyAdmin: CurrencyAdminPort = {
    create: async () => record(),
    upsert: async (input) => {
      calls.upsert.push(input);
      return record({ label: input.label });
    },
    update: async () => record(),
    setDefault: async (code) => {
      calls.setDefault.push(code);
      return record({ code, isDefault: true });
    },
    remove: async (code) => {
      calls.remove.push(code);
    },
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
    currencyAdmin,
    requireAdmin: () => async () => undefined,
  });
  await app.ready();
  return { app, calls };
}

describe('languages i18n routes — currency data comes from the published ports', () => {
  it('serves the public i18n config from the currency read port alone', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/i18n/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { currencies: Array<{ code: string }>; defaultCurrencyCode: string | null };
    };
    expect(body.data.currencies.map((c) => c.code)).toEqual(['XAA']);
    expect(body.data.defaultCurrencyCode).toBe('XAA');
    await app.close();
  });

  it('lists currencies for the admin surface from the read port', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/currencies' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toHaveLength(1);
    await app.close();
  });

  it('routes every currency write to the admin port', async () => {
    const { app, calls } = await buildApp();

    const upsert = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/currencies/XAA',
      payload: { label: 'Renamed', symbol: 'X' },
    });
    expect(upsert.statusCode).toBe(200);
    expect(calls.upsert).toEqual([{ code: 'XAA', label: 'Renamed', symbol: 'X' }]);

    const setDefault = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/currencies/XAA/default',
    });
    expect(setDefault.statusCode).toBe(200);
    expect(calls.setDefault).toEqual(['XAA']);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/currencies/XAA',
    });
    expect(removed.statusCode).toBe(204);
    expect(calls.remove).toEqual(['XAA']);

    await app.close();
  });
});
