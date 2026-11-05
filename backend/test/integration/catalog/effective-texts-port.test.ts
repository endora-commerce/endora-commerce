import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ScopeChannel } from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { testChannelBridges } from '../../helpers/channel-bridges.js';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import { ProductAvailabilityService } from '../../../../packages/modules/catalog/dist/backend/services/product-availability.service.js';

/**
 * Feature 174 (T049; FR-030, FR-031, `contracts/readers.md` §2) —
 * `catalogProductAvailabilityPort.effectiveTexts` and `effectivePackagingUnitNames` resolve along
 * C×L → C → Global: an own value at the request's (C, L) wins, else the channel's, else the Global
 * value; an **empty** override (`{"v": null}`) stops the fallback and answers `null` (a
 * description or a packaging-unit name deliberately left empty). `languageCode: null` is the
 * channel's default language; another channel's rows never leak; an unknown channel answers the
 * Global texts.
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

async function insertChannel(em: EntityManager): Promise<ScopeChannel> {
  const id = randomUUID();
  await em.execute(
    `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
     values (?, ?, '{"en-US":"174 texts"}'::jsonb, 'pl-PL', '["pl-PL","en-US"]'::jsonb, 'PLN', now(), now())`,
    [id, `et170-${id.slice(0, 8)}`],
  );
  return { id, languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL' };
}

async function insertProduct(em: EntityManager, name: string, description: string | null): Promise<string> {
  const id = randomUUID();
  await em.execute(
    `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
     values (?, ?, ?, 'simple', 'active', ?, ?, now(), now())`,
    [id, `ET170-${id.slice(0, 8)}`, `et170-${id.slice(0, 8)}`, name, description],
  );
  return id;
}

async function override(
  em: EntityManager,
  productId: string,
  field: 'name' | 'description',
  channelId: string,
  languageCode: string | null,
  value: string | null,
): Promise<void> {
  await em.execute(
    `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?::jsonb, now(), now())`,
    [randomUUID(), productId, field, channelId, languageCode, JSON.stringify({ v: value })],
  );
}

async function insertUnit(em: EntityManager, productId: string, name: string): Promise<string> {
  const id = randomUUID();
  await em.execute(
    `insert into product_packaging_units (id, product_id, name, base_quantity, position, is_default, created_at, updated_at)
     values (?, ?, ?, 1, 0, false, now(), now())`,
    [id, productId, name],
  );
  return id;
}

async function unitOverride(
  em: EntityManager,
  unitId: string,
  productId: string,
  channelId: string,
  languageCode: string | null,
  value: string | null,
): Promise<void> {
  await em.execute(
    `insert into product_packaging_unit_scope_overrides
       (id, packaging_unit_id, product_id, sales_channel_id, language_code, field, value)
     values (?, ?, ?, ?, ?, 'name', ?::jsonb)`,
    [randomUUID(), unitId, productId, channelId, languageCode, JSON.stringify({ v: value })],
  );
}

function port(channels: ScopeChannel[]): ProductAvailabilityService {
  const membership = new SalesChannelMembershipService(() => db.em(), new EventBus(), undefined, testChannelBridges());
  return new ProductAvailabilityService(() => db.em(), membership, {
    getById: async (id: string) => {
      const channel = channels.find((c) => c.id === id);
      return channel ? ({ ...channel, languages: [...channel.languages] } as never) : null;
    },
  } as never);
}

describe('174 — effectiveTexts / effectivePackagingUnitNames: C×L → C → G [integration]', () => {
  it('resolves name and description at C×L, C and Global, and an empty description override answers null', async () => {
    const em = db.em();
    const channel = await insertChannel(em);
    const other = await insertChannel(em);

    // Own value at C×L (pl-PL) and at C; en-US inherits the channel's.
    const layered = await insertProduct(em, 'Drill X', 'Global description');
    await override(em, layered, 'name', channel.id, 'pl-PL', 'Wiertarka X');
    await override(em, layered, 'name', channel.id, null, 'Drill X (channel)');
    await override(em, layered, 'description', channel.id, 'pl-PL', null); // empty override stops the chain
    await override(em, layered, 'description', channel.id, null, 'Channel description');

    // Only Global values; another channel's override must not leak.
    const globalOnly = await insertProduct(em, 'Hammer', null);
    await override(em, globalOnly, 'name', other.id, 'pl-PL', 'Młotek (other channel)');

    const svc = port([channel, other]);
    const pl = await svc.effectiveTexts([layered, globalOnly, randomUUID()], { channelId: channel.id, languageCode: 'pl-PL' });
    expect(pl.get(layered)).toEqual({ name: 'Wiertarka X', description: null });
    expect(pl.get(globalOnly)).toEqual({ name: 'Hammer', description: null });
    expect(pl.size).toBe(2); // an unknown id is absent

    const en = await svc.effectiveTexts([layered, globalOnly], { channelId: channel.id, languageCode: 'en-US' });
    expect(en.get(layered)).toEqual({ name: 'Drill X (channel)', description: 'Channel description' });
    expect(en.get(globalOnly)).toEqual({ name: 'Hammer', description: null });

    // `null` = the channel's default language (pl-PL).
    const operator = await svc.effectiveTexts([layered], { channelId: channel.id, languageCode: null });
    expect(operator.get(layered)).toEqual({ name: 'Wiertarka X', description: null });

    // The other channel sees its own C×L name and Global elsewhere.
    const elsewhere = await svc.effectiveTexts([layered, globalOnly], { channelId: other.id, languageCode: 'pl-PL' });
    expect(elsewhere.get(layered)).toEqual({ name: 'Drill X', description: 'Global description' });
    expect(elsewhere.get(globalOnly)).toEqual({ name: 'Młotek (other channel)', description: null });

    // An unknown channel answers the Global texts.
    const unknown = await svc.effectiveTexts([layered], { channelId: randomUUID(), languageCode: 'pl-PL' });
    expect(unknown.get(layered)).toEqual({ name: 'Drill X', description: 'Global description' });
  });

  it('resolves packaging-unit names at C×L, C and Global, and an empty override answers null', async () => {
    const em = db.em();
    const channel = await insertChannel(em);
    const other = await insertChannel(em);
    const productId = await insertProduct(em, 'Screws', null);
    const box = await insertUnit(em, productId, 'Box');
    const pallet = await insertUnit(em, productId, 'Pallet');
    const bag = await insertUnit(em, productId, 'Bag');

    await unitOverride(em, box, productId, channel.id, 'pl-PL', 'Karton');
    await unitOverride(em, box, productId, channel.id, null, 'Box (channel)');
    await unitOverride(em, pallet, productId, channel.id, 'pl-PL', null); // empty override
    await unitOverride(em, bag, productId, other.id, null, 'Bag (other channel)');

    const svc = port([channel, other]);
    const pl = await svc.effectivePackagingUnitNames([box, pallet, bag, randomUUID()], {
      channelId: channel.id,
      languageCode: 'pl-PL',
    });
    expect(pl.get(box)).toBe('Karton');
    expect(pl.get(pallet)).toBeNull();
    expect(pl.get(bag)).toBe('Bag');
    expect(pl.size).toBe(3);

    const en = await svc.effectivePackagingUnitNames([box, pallet, bag], { channelId: channel.id, languageCode: 'en-US' });
    expect(en.get(box)).toBe('Box (channel)');
    expect(en.get(pallet)).toBe('Pallet');
    expect(en.get(bag)).toBe('Bag');

    const operator = await svc.effectivePackagingUnitNames([box], { channelId: channel.id, languageCode: null });
    expect(operator.get(box)).toBe('Karton');

    const unknown = await svc.effectivePackagingUnitNames([box, pallet], { channelId: randomUUID(), languageCode: 'pl-PL' });
    expect(unknown.get(box)).toBe('Box');
    expect(unknown.get(pallet)).toBe('Pallet');
  });
});
