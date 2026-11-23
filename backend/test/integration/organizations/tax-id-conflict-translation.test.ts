import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriverException, UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Organization } from '../../helpers/package-entities.js';
import { TaxIdScopeService } from '../../../../packages/modules/organizations/src/backend/services/tax-id-scope-service.js';
import {
  TAX_ID_ONE_TREE_CONSTRAINT,
  TAX_ID_UNIQUE_CONSTRAINT,
  taxIdConflictOf,
} from '../../../../packages/modules/organizations/src/backend/services/tax-id-conflict.js';

/**
 * Issue #1860 (part of #1073). This pins, on MikroORM 6, what MikroORM gives
 * back when Postgres refuses a tax ID, and it must stay green after the move to
 * MikroORM 7.
 *
 * `tax-id-conflict.test.ts` covers `taxIdConflictOf` over hand-built errors. It
 * cannot see the other half: which class MikroORM's exception converter turns a
 * real `23505` / `23P01` into, and whether the pg error's `code` and
 * `constraint` are still on that exception or on what it wraps. Every write path
 * of `specs/177-tax-id-scope/` depends on both, and so does every
 * `instanceof UniqueConstraintViolationException` elsewhere in the tree. So the
 * errors here come from Postgres itself, through the routes the write paths
 * take:
 *
 *  - `global`: `organizations_tax_id_unique`, `23505` at the statement, by raw
 *    `em.execute` and by `em.flush()`;
 *  - `per-tree-root`: `organizations_tax_id_one_tree`, a deferred exclusion
 *    constraint, so `23P01` at the statement only once it is made immediate, and
 *    otherwise at `COMMIT`, out of `em.transactional`.
 *
 * MikroORM 6 has no class for `23P01`. At a statement it arrives as a plain
 * `DriverException`. At `COMMIT` MikroORM 6 does not convert it at all: what
 * `transactional` rejects with is pg's own error, with `code` and `constraint`
 * on it. This test does not require either exact class. It requires that the
 * refusal is never a unique violation, because an exclusion conflict read as a
 * unique one would change what every `instanceof` catch in the tree answers. At
 * a statement it must still be a `DriverException`, and `taxIdConflictOf` must
 * read it either way.
 *
 * Each case puts the scope it needs in place with the scope Command's own
 * statements (`TaxIdScopeService.applyEnforcement`), inside a transaction that
 * always rolls back, so neither the swap nor a row outlives it. That holds
 * whichever scope the run's template was built in.
 */
describe('tax-ID refusals as MikroORM delivers them (#1860)', () => {
  let db: TestDb;
  let scopes: TaxIdScopeService;
  let initialConstraints: string[];

  /** Thrown to end a transaction whose work is done, so it rolls back. */
  class RollBack extends Error {}

  beforeAll(async () => {
    db = await setupTestDb();
    scopes = new TaxIdScopeService(() => db.orm.em.fork() as EntityManager);
    initialConstraints = await scopes.presentConstraints();
  });

  afterAll(async () => {
    await db.close();
  });

  const fork = (): EntityManager => db.orm.em.fork() as EntityManager;
  const taxId = (): string => `TX${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;

  /** A root organization: `path` is `/<id>/`, so the generated `root_id` is its own id. */
  async function insertRoot(em: EntityManager, tax: string): Promise<void> {
    const id = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', false, '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::jsonb, ?, now(), now())`,
      [id, `T1860 ${id.slice(0, 8)}`, tax, `/${id}/`],
    );
  }

  function createRoot(em: EntityManager, tax: string): void {
    const id = randomUUID();
    em.create(Organization, {
      id,
      name: `T1860 ${id.slice(0, 8)}`,
      taxId: tax,
      status: 'active',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      path: `/${id}/`,
    } as never);
  }

  /**
   * Runs `write` in a transaction that never commits and returns what it threw.
   * The error is caught inside the transaction, so it is the statement's own
   * error, not one raised while committing or rolling back.
   */
  async function refusedAtStatement(write: (em: EntityManager) => Promise<void>): Promise<unknown> {
    let refusal: unknown = null;
    await fork()
      .transactional(async (em) => {
        try {
          await write(em as EntityManager);
        } catch (caught) {
          refusal = caught;
        }
        throw new RollBack();
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof RollBack)) throw caught;
      });
    return refusal;
  }

  function expectUniqueViolation(error: unknown): void {
    expect(error, 'the write was not refused').not.toBeNull();
    expect(error).toBeInstanceOf(UniqueConstraintViolationException);
    expect(taxIdConflictOf(error)).toBe('tax_id_exists');
  }

  function expectExclusionViolation(error: unknown, at: 'statement' | 'commit'): void {
    expect(error, 'the write was not refused').not.toBeNull();
    if (at === 'statement') expect(error).toBeInstanceOf(DriverException);
    expect(error).not.toBeInstanceOf(UniqueConstraintViolationException);
    expect(taxIdConflictOf(error)).toBe('tax_id_shared_across_trees');
  }

  describe(`global (${TAX_ID_UNIQUE_CONSTRAINT})`, () => {
    it('23505 by em.execute is a UniqueConstraintViolationException taxIdConflictOf reads as tax_id_exists', async () => {
      const error = await refusedAtStatement(async (em) => {
        await scopes.applyEnforcement(em, 'global');
        const shared = taxId();
        await insertRoot(em, shared);
        await insertRoot(em, shared);
      });
      expectUniqueViolation(error);
    });

    it('23505 by em.flush() is the same exception', async () => {
      const error = await refusedAtStatement(async (em) => {
        await scopes.applyEnforcement(em, 'global');
        const shared = taxId();
        createRoot(em, shared);
        await em.flush();
        createRoot(em, shared);
        await em.flush();
      });
      expectUniqueViolation(error);
    });
  });

  describe(`per-tree-root (${TAX_ID_ONE_TREE_CONSTRAINT})`, () => {
    it('23P01 at the statement, the constraint made immediate, is a DriverException read as tax_id_shared_across_trees', async () => {
      const error = await refusedAtStatement(async (em) => {
        await scopes.applyEnforcement(em, 'per-tree-root');
        await em.execute(`set constraints "${TAX_ID_ONE_TREE_CONSTRAINT}" immediate`);
        const shared = taxId();
        await insertRoot(em, shared);
        await insertRoot(em, shared);
      });
      expectExclusionViolation(error, 'statement');
    });

    it('23P01 at COMMIT, out of em.transactional after a clean flush, is the same', async () => {
      let flushed = false;
      const shared = taxId();
      const error = await fork()
        .transactional(async (em) => {
          await scopes.applyEnforcement(em as EntityManager, 'per-tree-root');
          createRoot(em as EntityManager, shared);
          createRoot(em as EntityManager, shared);
          // Deferred: the flush itself is accepted.
          await em.flush();
          flushed = true;
        })
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      if (error === null) {
        // The commit went through: the swap and both rows are real. Undo them
        // before failing, so no later file runs in a scope it did not choose.
        await fork().transactional(async (em) => {
          await em.execute('delete from "organizations" where "tax_id" = ?', [shared]);
          if (initialConstraints.includes(TAX_ID_UNIQUE_CONSTRAINT)) {
            await scopes.applyEnforcement(em as EntityManager, 'global');
          }
        });
      }
      expect(flushed, 'the deferred constraint refused the flush rather than the commit').toBe(true);
      expectExclusionViolation(error, 'commit');
    });
  });

  it('left the constraints as the run found them', async () => {
    expect(initialConstraints).toHaveLength(1);
    expect(await scopes.presentConstraints()).toEqual(initialConstraints);
  });
});
