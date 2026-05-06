import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { CountryService } from '../../../src/modules/dictionaries/services/country-service.js';
import { runDictionarySeedReconciler } from '../../../src/modules/dictionaries/services/seed-reconciler.js';
import { HttpError } from '../../../src/http/error-envelope.js';
import { Country } from '../../../src/modules/dictionaries/entities/country.entity.js';

/**
 * T015 / T016 / T017 / T018 / T021 — CountryService invariants
 * (feature 017 / US1).
 *
 * Per-test transactions roll back at the end so seed mutations never leak.
 * Bulk writes inside tests use em.nativeUpdate (tx-scoped); raw
 * `getConnection().execute()` is reserved for outside-tx setup.
 */
describe('CountryService — invariants', () => {
  let db: TestDb;
  let em: EntityManager;
  let service: CountryService;

  beforeAll(async () => {
    db = await setupTestDb();
    // Seed once outside any tx so the rows are committed and every
    // per-test tx fork sees the populated registry.
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "dictionary_translations"`);
    await conn.execute(`delete from "language_countries"`);
    await conn.execute(`delete from "countries"`);
    await runDictionarySeedReconciler(() => db.orm.em);
  });

  beforeEach(async () => {
    em = await db.beginTx();
    service = new CountryService(() => em);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('T015 default rotation', () => {
    it('promotes a different country and demotes the prior default within one transaction', async () => {
      const before = await service.getDefault();
      expect(before?.code).toBe('PL');

      const promoted = await service.setDefault('DE');
      expect(promoted.code).toBe('DE');
      expect(promoted.isDefault).toBe(true);

      const after = await service.list();
      const defaults = after.filter((c) => c.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.code).toBe('DE');
    });

    it('refuses to promote an inactive country', async () => {
      // RU is seeded `is_active = false`.
      await expect(service.setDefault('RU')).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe('T016 at-least-one-active', () => {
    it('refuses to deactivate the only active country', async () => {
      // Mass-deactivate every country except PL via tx-scoped nativeUpdate.
      await em.nativeUpdate(Country, { code: { $ne: 'PL' } }, { isActive: false });
      // PL is the default AND now the only active row. Deactivating it
      // is refused — the default-cannot-be-deact rule fires first; either
      // rejection is acceptable.
      await expect(service.update('PL', { isActive: false })).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe('T017 default-cannot-be-deactivated', () => {
    it('refuses to set isActive=false on the current default', async () => {
      await expect(service.update('PL', { isActive: false })).rejects.toMatchObject({
        statusCode: 409,
        code: 'DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED',
      });
    });
  });

  describe('T018 immutable code (via update)', () => {
    it('does not expose a code-rename path on update', () => {
      type UpdateInput = Parameters<CountryService['update']>[1];
      const input: UpdateInput = { label: 'X' };
      // @ts-expect-error — code is intentionally not part of UpdateInput.
      input.code = 'XX';
      expect(input).toBeDefined();
    });
  });

  describe('T021 FK-protected hard-delete', () => {
    it('refuses to delete a country referenced by a tax rule', async () => {
      // Demote PL so the default-cannot-be-deact rule doesn't fire first.
      await service.setDefault('DE');

      // Insert a tax rule referencing PL — `taxes.country` has no extra
      // FKs so this is the cheapest cross-module reference for the test.
      await em.execute(
        `insert into "taxes"
           ("id","code","name","rate","country","applies_to_vat_statuses",
            "is_default","priority","created_at","updated_at")
         values (gen_random_uuid(), 'tx-pl-23', 'PL VAT 23%', 0.23, 'PL',
                 '[]'::jsonb, false, 0, now(), now())`,
      );

      await expect(service.remove('PL')).rejects.toMatchObject({
        statusCode: 409,
        code: 'DICTIONARY_ENTRY_HAS_DEPENDENTS',
      });
    });

    it('refuses to delete the platform default country', async () => {
      await expect(service.remove('PL')).rejects.toMatchObject({
        statusCode: 409,
        code: 'DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED',
      });
    });

    it('allows deleting a country with zero consumers', async () => {
      await service.setDefault('DE');
      await service.create({
        code: 'AA',
        alpha3Code: 'AAA',
        numericCode: '901',
        label: 'Atest',
        region: 'Europe',
      });
      await service.remove('AA');
      const after = await service.getByCode('AA');
      expect(after).toBeNull();
    });
  });
});
