import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { LanguageService } from '../../../src/modules/languages/services/language-service.js';
import { runDictionarySeedReconciler } from '../../../src/modules/dictionaries/services/seed-reconciler.js';
import { Language } from '../../../src/modules/languages/entities/language.entity.js';

/**
 * T015 / T016 / T017 / T019 / T023 — LanguageService extended invariants
 * (feature 017 / US1).
 *
 * Covers: default rotation, at-least-one-active, default-cannot-be-
 * deactivated, fallback-cycle guard, FK-protected hard-delete with
 * consumer counts.
 */
describe('LanguageService — extended invariants', () => {
  let db: TestDb;
  let em: EntityManager;
  let service: LanguageService;

  beforeAll(async () => {
    db = await setupTestDb();
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "dictionary_translations"`);
    await conn.execute(`delete from "language_countries"`);
    await conn.execute(`delete from "countries"`);
    await runDictionarySeedReconciler(() => db.orm.em);
  });

  beforeEach(async () => {
    em = await db.beginTx();
    service = new LanguageService(() => em);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('T015 default rotation', () => {
    it('promotes a different language and demotes prior default within the open tx', async () => {
      // en-US is the seeded default per migration 012.
      const before = await service.getDefault();
      expect(before?.code).toBe('en-US');

      await service.setDefault('pl-PL');
      const after = await service.list();
      const defaults = after.filter((l) => l.isDefault);
      expect(defaults.map((l) => l.code)).toEqual(['pl-PL']);
    });
  });

  describe('T016 at-least-one-active', () => {
    it('refuses to deactivate the last active language', async () => {
      // Setup: only en-US (default) and pl-PL exist in the seed. Promote
      // pl-PL to default and deactivate en-US first (allowed — pl-PL is
      // still active). Then trying to deactivate pl-PL fires both the
      // default-cannot-be-deact AND the at-least-one rules — either
      // rejection is acceptable.
      await service.setDefault('pl-PL');
      await service.update('en-US', { isActive: false });
      await expect(service.update('pl-PL', { isActive: false })).rejects.toMatchObject({
        statusCode: 409,
      });
    });
  });

  describe('T017 default-cannot-be-deactivated', () => {
    it('refuses to set isActive=false on the current default', async () => {
      await expect(service.update('en-US', { isActive: false })).rejects.toMatchObject({
        statusCode: 409,
        code: 'DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED',
      });
    });
  });

  describe('T019 fallback-cycle guard', () => {
    it('refuses to set fallback_code = self', async () => {
      await expect(
        service.update('en-US', { fallbackCode: 'en-US' }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'DICTIONARY_FALLBACK_CYCLE',
      });
    });

    it('refuses to introduce a 2-node cycle', async () => {
      // Insert a third language via direct entity create (no service surface
      // for create yet — feature 017 keeps create() in the dictionary admin
      // surface that lands later in this phase).
      const de = em.create(Language, {
        code: 'de',
        label: 'German',
        nativeLabel: 'Deutsch',
      });
      await em.persistAndFlush(de);

      // Set en-US.fallback_code = de (no cycle yet).
      await service.update('en-US', { fallbackCode: 'de' });
      // Now setting de.fallback_code = en-US would create the cycle
      // en-US → de → en-US. Must be refused.
      await expect(service.update('de', { fallbackCode: 'en-US' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'DICTIONARY_FALLBACK_CYCLE',
      });
    });

    it('allows a non-cycling fallback chain', async () => {
      const de = em.create(Language, {
        code: 'de',
        label: 'German',
        nativeLabel: 'Deutsch',
      });
      const deAt = em.create(Language, {
        code: 'de-AT',
        label: 'German (Austria)',
        nativeLabel: 'Österreichisches Deutsch',
      });
      await em.persistAndFlush([de, deAt]);

      // de-AT → de — valid chain.
      const updated = await service.update('de-AT', { fallbackCode: 'de' });
      expect(updated.fallbackCode).toBe('de');
    });
  });

  describe('T023 FK-protected hard-delete', () => {
    it('refuses to delete a language referenced by a sales channel default_language', async () => {
      // Promote pl-PL so en-US is no longer the default.
      await service.setDefault('pl-PL');
      // Seeded `Default` sales channel has `default_language = en-US`
      // (constitution + feature 005 boot defaults). Deletion of en-US
      // must be refused with consumer counts.
      await expect(service.remove('en-US')).rejects.toMatchObject({
        statusCode: 409,
        code: 'DICTIONARY_ENTRY_HAS_DEPENDENTS',
      });
    });
  });
});
