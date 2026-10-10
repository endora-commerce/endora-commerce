import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Migration20261010T090000CustomFieldsDefinitionAudience } from '@endora-commerce/mod-custom-fields/migrations';

/**
 * The upgrade that gives a custom-field definition its audience changes
 * nothing on its own: a definition that existed before it keeps answering its
 * values to the customer, as it did. Only a definition written afterwards
 * without an audience is internal.
 *
 * Each case rebuilds the pre-migration table inside a transaction that is
 * rolled back, so the schema every other file reads is untouched.
 */
describe('custom_fields — the audience column over existing definitions', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
    await em.execute('alter table "custom_field_definitions" drop column "audience"');
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  async function insertDefinition(key: string): Promise<void> {
    await em.execute(
      `insert into "custom_field_definitions"
         ("id", "entity_type", "key", "label_default", "value_type", "created_at", "updated_at")
       values (?, 'order', ?, ?, 'text', now(), now())`,
      [randomUUID(), key, key],
    );
  }

  async function migrate(): Promise<void> {
    const migration = new Migration20261010T090000CustomFieldsDefinitionAudience(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    for (const query of migration.getQueries()) await em.execute(query as unknown as string);
  }

  async function audienceOf(key: string): Promise<string | undefined> {
    const rows = await em.execute<Array<{ audience: string }>>(
      `select "audience" from "custom_field_definitions" where "key" = ?`,
      [key],
    );
    return rows[0]?.audience;
  }

  it('leaves every existing definition customer-visible', async () => {
    const before = `aud_before_${randomUUID().slice(0, 8)}`;
    await insertDefinition(before);
    await migrate();
    expect(await audienceOf(before)).toBe('customer');
    const others = await em.execute<Array<{ n: string }>>(
      `select count(*)::text as n from "custom_field_definitions" where "audience" <> 'customer'`,
    );
    expect(others[0]!.n).toBe('0');
  });

  it('makes a definition written afterwards without an audience internal', async () => {
    await migrate();
    const after = `aud_after_${randomUUID().slice(0, 8)}`;
    await insertDefinition(after);
    expect(await audienceOf(after)).toBe('internal');
  });
});
