import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { CurrencyService } from '../../../../packages/modules/currencies/src/backend/services/currency-service.js';
import { runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';


/**
 * T015 / T016 / T017 / T022 — CurrencyService extended invariants
 * (feature 017 / US1).
 */
describe('CurrencyService — extended invariants', () => {
  let db: TestDb;
  let em: EntityManager;
  let service: CurrencyService;

  beforeAll(async () => {
    db = await setupTestDb();
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "dictionary_translations"`);
    await conn.execute(`delete from "language_countries"`);
    await conn.execute(`delete from "countries"`);
    await runDictionarySeedReconcilerFor(() => db.orm.em);
  });

  beforeEach(async () => {
    em = await db.beginTx();
    service = new CurrencyService(() => em);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('T015 default rotation — promotes EUR; PLN demoted', async () => {
    const before = await service.getDefault();
    expect(before?.code).toBe('PLN');

    await service.setDefault('EUR');
    const after = await service.list();
    const defaults = after.filter((c) => c.isDefault);
    expect(defaults.map((c) => c.code)).toEqual(['EUR']);
  });

  it('T017 default-cannot-be-deactivated — refuses to deactivate the platform default', async () => {
    await expect(service.update('PLN', { isActive: false })).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED',
    });
  });

  it('T027 extended-field update — symbolPosition + decimalPlaces persist', async () => {
    const updated = await service.update('JPY', {
      symbolPosition: 'suffix',
      decimalPlaces: 2,
    });
    expect(updated.symbolPosition).toBe('suffix');
    expect(updated.decimalPlaces).toBe(2);
  });

  it('T027 extended-field update — refuses out-of-range decimalPlaces', async () => {
    await expect(service.update('PLN', { decimalPlaces: 7 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'VALIDATION_FAILED',
    });
  });

  it('T022 FK-protected hard-delete — refuses to delete a currency referenced by sales channel default', async () => {
    // Promote EUR so PLN is no longer default.
    await service.setDefault('EUR');
    // The seeded `Default` sales channel has `default_currency = PLN`
    // (per feature 005 boot), making PLN protected.
    await expect(service.remove('PLN')).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_HAS_DEPENDENTS',
    });
  });
});
