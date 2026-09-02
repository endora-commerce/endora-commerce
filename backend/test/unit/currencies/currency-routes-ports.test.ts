import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import type {
  CurrencyAdminPort,
  CurrencyReadPort,
  CurrencyRecord,
} from '@endora-commerce/contracts';
import { registerCurrencyRoutes } from '../../../../packages/modules/currencies/src/backend/routes.js';

/**
 * The currency admin surface, now registered by the module that owns the table
 * (2026-08-29).
 *
 * These four routes and the port wiring behind them lived in `languages` until
 * this change — `test/unit/languages/i18n-routes-currency-ports.test.ts` is
 * where this file's assertions come from, and that file keeps the one route
 * that genuinely composes both catalogues.
 *
 * Two things are asserted that the old file could not. Each route enforces this
 * module's own code rather than `catalog:write`, and the read and the writes
 * enforce **different** ones: listing the currencies used to require the
 * authority to delete one, because all four routes carried the write code. The
 * `requireAdmin` stub records what it was asked for, which is the only place a
 * unit test can see a gate that a running server would answer with 403.
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
  readonly gates: string[];
}

async function buildApp(): Promise<{ app: FastifyInstance; calls: Calls }> {
  const calls: Calls = { upsert: [], setDefault: [], remove: [], gates: [] };
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

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerCurrencyRoutes(app, {
    currencyRead,
    currencyAdmin,
    // The stub records the code each route asked for, which is the only place
    // a unit test can see a gate a running server would answer with 403.
    requireAdmin: (permission?: string) => {
      calls.gates.push(permission ?? '<none>');
      return async (): Promise<void> => undefined;
    },
  });
  await app.ready();
  return { app, calls };
}

describe('currencies admin routes — served by their owner, over its own ports', () => {
  it('lists currencies from the read port', async () => {
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

  it('gates the read and the three writes on this module’s own codes', async () => {
    const { app, calls } = await buildApp();
    // Registration order: list, upsert, set-default, delete. All four said
    // `catalog:write` until this change, so both halves of the assertion are
    // the repair: the codes are the module's own, and the read is not the write.
    expect(calls.gates).toEqual([
      'currencies:read',
      'currencies:write',
      'currencies:write',
      'currencies:write',
    ]);
    expect(calls.gates).not.toContain('catalog:write');
    await app.close();
  });
});
