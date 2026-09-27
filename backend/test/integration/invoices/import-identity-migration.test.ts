import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Migration } from '@mikro-orm/migrations';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { OTHER_TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { Migration20260926T230239InvoicesImportIdentity } from '../../../../packages/modules/invoices/src/migrations/20260926T230239_invoices_import_identity.js';

/**
 * Imported-invoice identity is `(system, externalId)` — feature 134's T135,
 * `specs/134-paid-module-extraction/research.md` D21 §3.
 *
 * Before T135 an `erp_import` row was identified by
 * `external_document_ref->>'xlSaleDocumentId'` alone, so a second source
 * system's id collided with the first's. The migration renames the persisted
 * keys (`xlSaleDocumentId` → `externalId`, `xlDocumentNumber` →
 * `externalNumber`) and the attachment column, replaces the id-only unique
 * index with one on the pair, and adds a check refusing an empty identity.
 *
 * Driven against the harness's own database — never the dev one — inside one
 * transaction that is rolled back, the way
 * `integration/payments/refunded-amount-column.test.ts` drives its migration:
 * the harness database is already migrated, so each case first runs `down()`
 * to stage the pre-T135 schema, and Postgres DDL is transactional, so that
 * costs the next test nothing. A refused statement aborts a Postgres
 * transaction, so every expected refusal runs under its own savepoint.
 */

type MigrationClass = new (...args: ConstructorParameters<typeof Migration>) => Migration;

const Subject = Migration20260926T230239InvoicesImportIdentity;

let db: TestDb;

beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.beginTx();
});
afterEach(async () => {
  await db.rollbackTx();
});

async function queued(cls: MigrationClass, direction: 'up' | 'down'): Promise<string[]> {
  const migration = new cls(db.orm.em.getDriver(), db.orm.config);
  await migration[direction]();
  return migration.getQueries().map((query) => query.toString());
}

async function run(cls: MigrationClass, direction: 'up' | 'down'): Promise<void> {
  for (const sql of await queued(cls, direction)) await db.em().execute(sql);
}

/** Runs `sql` under a savepoint and answers whether Postgres refused it. */
async function refused(em: EntityManager, sql: string, params: unknown[]): Promise<boolean> {
  await em.execute('savepoint t135_probe');
  try {
    await em.execute(sql, params);
    await em.execute('release savepoint t135_probe');
    return false;
  } catch {
    await em.execute('rollback to savepoint t135_probe');
    return true;
  }
}

/**
 * The pre-T135 schema, with no `erp_import` row in it. Rows other test files
 * left behind are deleted inside this transaction, so `down()` never meets a
 * pair of systems sharing an id that some other suite wrote.
 */
async function stageOldSchema(em: EntityManager): Promise<void> {
  await seedOtherTestOrganization(em);
  await em.execute(`delete from invoices where origin = 'erp_import'`);
  await run(Subject, 'down');
}

/** Inserts one `erp_import` row with `ref` as its stored JSONB, verbatim. */
function insertImportedSql(): string {
  return `insert into invoices
      (id, number, kind, currency, total, paid_total, status, issued_at,
       created_at, updated_at, origin, organization_id, external_document_ref)
    values (?, ?, 'invoice', 'PLN', '10.00', '0', 'ready', now(), now(), now(),
            'erp_import', ?, ?::jsonb)`;
}

async function insertImported(em: EntityManager, ref: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await em.execute(insertImportedSql(), [
    id,
    `T135/${id.slice(0, 8)}`,
    OTHER_TEST_ORGANIZATION_ID,
    JSON.stringify(ref),
  ]);
  return id;
}

function insertImportedParams(ref: Record<string, unknown>): unknown[] {
  const id = randomUUID();
  return [id, `T135/${id.slice(0, 8)}`, OTHER_TEST_ORGANIZATION_ID, JSON.stringify(ref)];
}

async function refOf(em: EntityManager, id: string): Promise<Record<string, unknown>> {
  const rows = await em.execute<{ ref: Record<string, unknown> }[]>(
    `select external_document_ref as ref from invoices where id = ?`,
    [id],
  );
  return rows[0]!.ref;
}

async function attachmentColumns(em: EntityManager): Promise<string[]> {
  const rows = await em.execute<{ column_name: string }[]>(
    `select column_name from information_schema.columns
      where table_schema = current_schema() and table_name = 'invoice_external_attachments'
      order by column_name`,
  );
  return rows.map((row) => row.column_name);
}

async function constraintNames(em: EntityManager, table: string): Promise<string[]> {
  const rows = await em.execute<{ conname: string }[]>(
    `select c.conname from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where t.relname = ? and n.nspname = current_schema()`,
    [table],
  );
  return rows.map((row) => row.conname);
}

async function indexDefinition(em: EntityManager, name: string): Promise<string | null> {
  const rows = await em.execute<{ indexdef: string }[]>(
    `select indexdef from pg_indexes where schemaname = current_schema() and indexname = ?`,
    [name],
  );
  return rows[0]?.indexdef ?? null;
}

describe('invoices import identity — the T135 migration (D21 §3)', () => {
  it('up(): renames the keys, the column and the constraint, and scopes identity to the pair', async () => {
    const em = db.em();
    await stageOldSchema(em);

    const invoiceId = await insertImported(em, {
      system: 'comarch_xl',
      xlSaleDocumentId: 'XL-100',
      xlDocumentNumber: 'FV/XL/100',
      documentKind: 'invoice',
    });
    const withoutNumber = await insertImported(em, {
      system: 'comarch_xl',
      xlSaleDocumentId: 'XL-101',
      documentKind: 'wz',
    });
    await em.execute(
      `insert into invoice_external_attachments
         (id, invoice_id, xl_attachment_id, file_name, created_at, updated_at)
       values (?, ?, 'ATT-1', 'invoice.pdf', now(), now())`,
      [randomUUID(), invoiceId],
    );

    await run(Subject, 'up');

    expect(await refOf(em, invoiceId)).toEqual({
      system: 'comarch_xl',
      externalId: 'XL-100',
      externalNumber: 'FV/XL/100',
      documentKind: 'invoice',
    });
    // An absent number stays absent rather than becoming `"externalNumber": null`.
    expect(await refOf(em, withoutNumber)).toEqual({
      system: 'comarch_xl',
      externalId: 'XL-101',
      documentKind: 'wz',
    });

    const columns = await attachmentColumns(em);
    expect(columns).toContain('external_attachment_id');
    expect(columns).not.toContain('xl_attachment_id');
    const attachment = await em.execute<{ external_attachment_id: string }[]>(
      `select external_attachment_id from invoice_external_attachments where invoice_id = ?`,
      [invoiceId],
    );
    expect(attachment[0]?.external_attachment_id).toBe('ATT-1');

    const attachmentConstraints = await constraintNames(em, 'invoice_external_attachments');
    expect(attachmentConstraints).toContain('invoice_external_attachments_invoice_external_uq');
    expect(attachmentConstraints).not.toContain('invoice_external_attachments_invoice_xl_uq');

    expect(await indexDefinition(em, 'invoices_external_xl_sale_document_uq')).toBeNull();
    const pairIndex = await indexDefinition(em, 'invoices_external_document_uq');
    expect(pairIndex).toMatch(/UNIQUE INDEX/);
    expect(pairIndex).toContain(`'system'`);
    expect(pairIndex).toContain(`'externalId'`);
    expect(pairIndex).toMatch(/WHERE .*erp_import/);
    expect(await constraintNames(em, 'invoices')).toContain('invoices_erp_import_identity_chk');

    // A second system's document with the same id is another document.
    expect(
      await refused(
        em,
        insertImportedSql(),
        insertImportedParams({ system: 'erp_fixture', externalId: 'XL-100', documentKind: 'invoice' }),
      ),
    ).toBe(false);
    // The same pair twice is one document.
    expect(
      await refused(
        em,
        insertImportedSql(),
        insertImportedParams({ system: 'comarch_xl', externalId: 'XL-100', documentKind: 'invoice' }),
      ),
    ).toBe(true);
  });

  it('up(): the check refuses an erp_import row with an empty or missing identity', async () => {
    const em = db.em();
    await stageOldSchema(em);
    await run(Subject, 'up');

    for (const ref of [
      { system: 'comarch_xl', externalId: '', documentKind: 'invoice' },
      { system: 'comarch_xl', documentKind: 'invoice' },
      { system: '', externalId: 'X-1', documentKind: 'invoice' },
      { externalId: 'X-1', documentKind: 'invoice' },
      // The pre-T135 shape: the id under the old key only.
      { system: 'comarch_xl', xlSaleDocumentId: 'X-1', documentKind: 'invoice' },
    ]) {
      expect(await refused(em, insertImportedSql(), insertImportedParams(ref)), JSON.stringify(ref)).toBe(
        true,
      );
    }
  });

  it('down(): restores the pre-T135 shape while a single system has written', async () => {
    const em = db.em();
    await stageOldSchema(em);
    const invoiceId = await insertImported(em, {
      system: 'comarch_xl',
      xlSaleDocumentId: 'XL-200',
      xlDocumentNumber: 'FV/XL/200',
      documentKind: 'invoice',
    });
    await em.execute(
      `insert into invoice_external_attachments
         (id, invoice_id, xl_attachment_id, file_name, created_at, updated_at)
       values (?, ?, 'ATT-2', 'invoice.pdf', now(), now())`,
      [randomUUID(), invoiceId],
    );
    await run(Subject, 'up');

    await run(Subject, 'down');

    expect(await refOf(em, invoiceId)).toEqual({
      system: 'comarch_xl',
      xlSaleDocumentId: 'XL-200',
      xlDocumentNumber: 'FV/XL/200',
      documentKind: 'invoice',
    });
    const columns = await attachmentColumns(em);
    expect(columns).toContain('xl_attachment_id');
    expect(columns).not.toContain('external_attachment_id');
    const attachmentConstraints = await constraintNames(em, 'invoice_external_attachments');
    expect(attachmentConstraints).toContain('invoice_external_attachments_invoice_xl_uq');
    expect(attachmentConstraints).not.toContain('invoice_external_attachments_invoice_external_uq');
    expect(await indexDefinition(em, 'invoices_external_document_uq')).toBeNull();
    expect(await indexDefinition(em, 'invoices_external_xl_sale_document_uq')).toMatch(
      /xlSaleDocumentId/,
    );
    expect(await constraintNames(em, 'invoices')).not.toContain('invoices_erp_import_identity_chk');

    // And `up()` again is the same migration over the restored shape.
    await run(Subject, 'up');
    expect((await refOf(em, invoiceId))['externalId']).toBe('XL-200');
  });

  it('down(): fails loudly once two systems share an id — the id-only index cannot hold', async () => {
    const em = db.em();
    await stageOldSchema(em);
    await run(Subject, 'up');
    await insertImported(em, { system: 'comarch_xl', externalId: 'SHARED', documentKind: 'invoice' });
    await insertImported(em, { system: 'erp_fixture', externalId: 'SHARED', documentKind: 'invoice' });

    await em.execute('savepoint t135_down');
    await expect(run(Subject, 'down')).rejects.toThrow();
    await em.execute('rollback to savepoint t135_down');
  });
});
