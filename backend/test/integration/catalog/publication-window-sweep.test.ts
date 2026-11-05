import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  PUBLICATION_WINDOW_SWEEP_EVERY_MS,
  PUBLICATION_WINDOW_WATERMARK_KEY,
  PublicationWindowSweep,
  type PublicationWindowEvent,
} from '../../../../packages/modules/catalog/dist/backend/services/publication-window-sweep.js';

/**
 * Feature 163, Phase 7 (T050, R9, FR-024, A-4) — the publication-window sweep.
 *
 *  - a bound crossed in `(lastSweep, now]` — global, or an **overridden** channel
 *    window — emits one `product.updated.v1` `['publicationWindow']` per product;
 *  - a second sweep over the same instant emits nothing (idempotent);
 *  - with no watermark the interval starts at `now − 2 × interval`;
 *  - no stored status is written.
 */

const NOW = new Date('2031-06-15T12:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

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

async function insertProduct(em: EntityManager, window: { from?: Date; until?: Date } = {}): Promise<string> {
  const id = randomUUID();
  const stamp = `${id.slice(0, 8)}`;
  await em.execute(
    `insert into products (id, sku, slug, type, status, name, description, publish_from, publish_until, created_at, updated_at)
     values (?, ?, ?, 'simple', 'active', 'Sweep', '', ?, ?, now(), now())`,
    [id, `S163-SWEEP-${stamp}`, `s163-sweep-${stamp}`, window.from ?? null, window.until ?? null],
  );
  return id;
}

async function insertChannel(em: EntityManager): Promise<string> {
  const id = randomUUID();
  await em.execute(
    `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
     values (?, ?, '{"en-US":"sweep"}'::jsonb, 'pl-PL', '["pl-PL"]'::jsonb, 'PLN', now(), now())`,
    [id, `sw163-${id.slice(0, 8)}`],
  );
  return id;
}

function rig(watermark?: Date) {
  const store = new Map<string, string>();
  if (watermark) store.set(PUBLICATION_WINDOW_WATERMARK_KEY, String(watermark.getTime()));
  const events: PublicationWindowEvent[] = [];
  const sweep = new PublicationWindowSweep(
    () => db.em(),
    {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      },
    } as never,
    (event) => {
      events.push(event);
    },
  );
  return { sweep, events, store };
}

describe('163 — publication-window sweep [integration]', () => {
  it('emits once per product whose bound was crossed, global or overridden channel window', async () => {
    const em = db.em();
    const channelId = await insertChannel(em);
    const opens = await insertProduct(em, { from: minutes(-3) });
    const closes = await insertProduct(em, { until: minutes(-1) });
    const later = await insertProduct(em, { from: minutes(+3) });
    const before = await insertProduct(em, { from: minutes(-30) });
    const overridden = await insertProduct(em);
    const inheriting = await insertProduct(em);
    await em.execute(
      `insert into product_channel_scopes (product_id, sales_channel_id, window_overridden, publish_from, created_at, updated_at)
       values (?, ?, true, ?, now(), now())`,
      [overridden, channelId, minutes(-2)],
    );
    // A channel row that does not override the window carries no bounds (CHECK) —
    // and a status row alone never counts as a crossing.
    await em.execute(
      `insert into product_channel_scopes (product_id, sales_channel_id, status, created_at, updated_at) values (?, ?, 'inactive', now(), now())`,
      [inheriting, channelId],
    );

    const { sweep, events, store } = rig(minutes(-5));
    const result = await sweep.sweep(NOW);

    const emitted = events.map((e) => e.productId);
    expect(emitted).toEqual(expect.arrayContaining([opens, closes, overridden]));
    expect(emitted).not.toContain(later);
    expect(emitted).not.toContain(before);
    expect(emitted).not.toContain(inheriting);
    expect(new Set(emitted).size).toBe(emitted.length);
    expect(events.every((e) => e.changedFields.length === 1 && e.changedFields[0] === 'publicationWindow')).toBe(true);
    expect(result.from).toEqual(minutes(-5));
    expect(store.get(PUBLICATION_WINDOW_WATERMARK_KEY)).toBe(String(NOW.getTime()));

    // No status was written (A-4).
    const statuses = await em.execute<Array<{ status: string }>>(
      `select status from products where id in (?, ?, ?)`,
      [opens, closes, overridden],
    );
    expect(statuses.every((row) => row.status === 'active')).toBe(true);

    // Idempotent: the same instant again emits nothing.
    events.length = 0;
    await sweep.sweep(NOW);
    expect(events).toEqual([]);
  });

  it('starts at now − 2 × interval when there is no watermark', async () => {
    const em = db.em();
    const inside = await insertProduct(em, { from: new Date(NOW.getTime() - PUBLICATION_WINDOW_SWEEP_EVERY_MS - 1000) });
    const outside = await insertProduct(em, { from: new Date(NOW.getTime() - 3 * PUBLICATION_WINDOW_SWEEP_EVERY_MS) });
    const { sweep, events } = rig();
    const result = await sweep.sweep(NOW);
    expect(result.from.getTime()).toBe(NOW.getTime() - 2 * PUBLICATION_WINDOW_SWEEP_EVERY_MS);
    const emitted = events.map((e) => e.productId);
    expect(emitted).toContain(inside);
    expect(emitted).not.toContain(outside);
  });
});
