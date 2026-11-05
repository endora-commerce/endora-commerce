import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { effectiveSystemText, type OverrideRow } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { effectiveTextSql } from '../../../../packages/modules/catalog/dist/backend/services/effective-value.sql.js';

/**
 * Feature 163 (T057), rewritten by feature 174 (T033; research R1, R22) — `effectiveTextSql`
 * equals the TypeScript chain (`effectiveSystemText`: C×L → C → Global) over a grid: a row at the
 * request's (C, L), at another language, at C, an **empty** override (`{"v": null}`) and an empty
 * string, another channel's rows, and a Global description present or absent. The expectation is
 * derived from the TypeScript, never written out; an empty override is `''` in SQL and `null` in
 * TypeScript (both "no text").
 */

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

async function insertChannel(em: EntityManager): Promise<string> {
  const id = randomUUID();
  await em.execute(
    `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
     values (?, ?, '{"en-US":"parity"}'::jsonb, 'pl-PL', '["pl-PL","en-US","de-DE"]'::jsonb, 'PLN', now(), now())`,
    [id, `ep170-${id.slice(0, 8)}`],
  );
  return id;
}

const GLOBALS: Array<string | null> = ['Global text', null, ''];
type Slot = string | null; // language, or null = the channel row
const OVERRIDE_SETS: Array<Array<{ slot: Slot; value: unknown; other?: boolean }>> = [
  [],
  [{ slot: 'pl-PL', value: 'Override PL' }],
  [{ slot: 'en-US', value: 'Override EN' }],
  [{ slot: null, value: 'Override channel' }],
  [{ slot: 'pl-PL', value: null }, { slot: null, value: 'Override channel' }],
  [{ slot: null, value: null }],
  [{ slot: 'pl-PL', value: '' }],
  [{ slot: 'pl-PL', value: 'Other channel', other: true }],
  [{ slot: 'en-US', value: 'Override EN' }, { slot: null, value: 'Override channel' }],
];
const LANGUAGES: Array<string | null> = ['pl-PL', 'en-US', 'de-DE', null];

describe('174 — effectiveTextSql ≡ the C×L → C → G chain [integration]', () => {
  it('equals effectiveSystemText over the grid', async () => {
    const em = db.em();
    const channelId = await insertChannel(em);
    const otherChannelId = await insertChannel(em);
    const products: Array<{ id: string; global: string | null; rows: OverrideRow[] }> = [];
    for (const global of GLOBALS) {
      for (const set of OVERRIDE_SETS) {
        const id = randomUUID();
        await em.execute(
          `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
           values (?, ?, ?, 'simple', 'active', 'Name', ?, now(), now())`,
          [id, `EP170-${id.slice(0, 8)}`, `ep170-${id.slice(0, 8)}`, global],
        );
        const rows: OverrideRow[] = [];
        for (const o of set) {
          const rowChannel = o.other ? otherChannelId : channelId;
          await em.execute(
            `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
             values (?, ?, 'description', ?, ?, ?::jsonb, now(), now())`,
            [randomUUID(), id, rowChannel, o.slot, JSON.stringify({ v: o.value })],
          );
          rows.push({ attributeKey: 'description', channelId: rowChannel, languageCode: o.slot, value: { v: o.value } });
        }
        products.push({ id, global, rows });
      }
    }

    for (const languageCode of LANGUAGES) {
      const expr = effectiveTextSql('description', { channelId, languageCode });
      const ids = products.map((p) => p.id);
      const rows = await em.execute<Array<{ id: string; v: string }>>(
        `select p.id::text as id, ${expr.sql('p')} as v from products p where p.id in (${ids.map(() => '?').join(',')})`,
        [...expr.params, ...ids],
      );
      const byId = new Map(rows.map((r) => [r.id, r.v]));
      for (const p of products) {
        const want = effectiveSystemText(p.rows, 'description', { channelId, languageCode }, p.global) ?? '';
        expect(byId.get(p.id), `${JSON.stringify(p.global)} ${JSON.stringify(p.rows)} at ${languageCode}`).toBe(want);
      }
    }
  });
});
