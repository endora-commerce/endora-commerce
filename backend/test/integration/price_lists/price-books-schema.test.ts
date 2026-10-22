import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CustomerGroup, Organization } from '../../helpers/package-entities.js';

/**
 * Feature 160 (D-287 P1) — the expand migration of `price_lists`: the price-book
 * header columns, the audience and channel sets, the evolved rows, the
 * precedence configuration and the price-surface tables (data-model §1–§6;
 * FR-001, FR-009, FR-021).
 *
 * Every statement here runs outside a transaction on purpose: a refused
 * statement is the assertion, and a refusal inside one would abort the rest.
 * Each test removes what it inserted.
 */

describe('price_lists — price-book schema (feature 160)', () => {
  let h: BackendServerHandle;
  let em: EntityManager;
  let channelId: string;
  let organizationId: string;
  let customerGroupId: string;

  const sql = <T = Record<string, unknown>>(statement: string, params: unknown[] = []) =>
    em.getConnection().execute<T[]>(statement, params);

  async function insertBook(overrides: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    const row = {
      id,
      name: 'Schema book',
      currency_code: 'PLN',
      audience_kind: 'everyone',
      type: 'regular',
      status: 'draft',
      is_system: false,
      ...overrides,
    };
    const columns = Object.keys(row);
    await sql(
      `insert into "price_lists" (${columns.map((c) => `"${c}"`).join(', ')}, "priority", "created_at", "updated_at")
       values (${columns.map(() => '?').join(', ')}, 0, now(), now())`,
      Object.values(row),
    );
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    em = h.em().fork();
    channelId = (await sql<{ id: string }>(`select "id" from "sales_channels" where "system_default" = true`))[0]!
      .id;
    const stamp = randomUUID().slice(0, 8);
    const organization = em.create(Organization, {
      name: 'Schema org',
      taxId: `SCHEMA-${stamp}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: { street: 'Test 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    });
    const group = em.create(CustomerGroup, { code: `schema-${stamp}`, name: 'Schema group' });
    await em.persistAndFlush([organization, group]);
    organizationId = organization.id;
    customerGroupId = group.id;
  });

  afterAll(async () => {
    await sql(`delete from "organizations" where "id" = ?`, [organizationId]);
    await sql(`delete from "customer_groups" where "id" = ?`, [customerGroupId]);
    await teardownBackendServer(h);
  });

  it('the header carries currency_code and audience_kind, and refuses an unknown audience kind or type', async () => {
    const id = await insertBook();
    const [book] = await sql<{ currency_code: string; audience_kind: string }>(
      `select "currency_code", "audience_kind" from "price_lists" where "id" = ?`,
      [id],
    );
    expect(book).toEqual({ currency_code: 'PLN', audience_kind: 'everyone' });
    await expect(insertBook({ audience_kind: 'mixed' })).rejects.toThrow(/audience_kind/);
    await expect(insertBook({ type: 'special' })).rejects.toThrow(/type/);
    await sql(`delete from "price_lists" where "id" = ?`, [id]);
  });

  it('allows one system (base) book per currency', async () => {
    const eur = await insertBook({ is_system: true, currency_code: 'EUR', status: 'active' });
    await expect(
      insertBook({ is_system: true, currency_code: 'EUR', status: 'active' }),
    ).rejects.toThrow(/price_lists_system_currency_unique/);
    const usd = await insertBook({ is_system: true, currency_code: 'USD', status: 'active' });
    await sql(`delete from "price_lists" where "id" in (?, ?)`, [eur, usd]);
  });

  it('an audience member names exactly one of an organization and a customer group', async () => {
    const id = await insertBook({ audience_kind: 'organizations' });
    await sql(`insert into "price_list_audience_members" ("price_list_id", "organization_id") values (?, ?)`, [
      id,
      organizationId,
    ]);
    await expect(
      sql(
        `insert into "price_list_audience_members" ("price_list_id", "organization_id", "customer_group_id") values (?, ?, ?)`,
        [id, organizationId, customerGroupId],
      ),
    ).rejects.toThrow(/price_list_audience_members_one_member_check/);
    await expect(
      sql(`insert into "price_list_audience_members" ("price_list_id") values (?)`, [id]),
    ).rejects.toThrow(/price_list_audience_members_one_member_check/);
    await expect(
      sql(`insert into "price_list_audience_members" ("price_list_id", "organization_id") values (?, ?)`, [
        id,
        organizationId,
      ]),
    ).rejects.toThrow(/unique/i);
    await sql(`delete from "price_lists" where "id" = ?`, [id]);
    const [{ count }] = (await sql<{ count: string }>(
      `select count(*)::text as count from "price_list_audience_members" where "price_list_id" = ?`,
      [id],
    )) as [{ count: string }];
    expect(count).toBe('0');
  });

  it('a permanently deleted member leaves the set (cascade)', async () => {
    const id = await insertBook({ audience_kind: 'customer_groups' });
    const gone = em.create(CustomerGroup, { code: `gone-${id.slice(0, 8)}`, name: 'Gone' });
    await em.persistAndFlush(gone);
    await sql(`insert into "price_list_audience_members" ("price_list_id", "customer_group_id") values (?, ?)`, [
      id,
      gone.id,
    ]);
    await sql(`delete from "customer_groups" where "id" = ?`, [gone.id]);
    const rows = await sql(`select 1 from "price_list_audience_members" where "price_list_id" = ?`, [id]);
    expect(rows).toHaveLength(0);
    await sql(`delete from "price_lists" where "id" = ?`, [id]);
  });

  it('the channel set is a bridge table that cascades from both sides', async () => {
    const id = await insertBook();
    await sql(`insert into "sales_channel_price_lists" ("sales_channel_id", "price_list_id") values (?, ?)`, [
      channelId,
      id,
    ]);
    await sql(`delete from "price_lists" where "id" = ?`, [id]);
    expect(await sql(`select 1 from "sales_channel_price_lists" where "price_list_id" = ?`, [id])).toHaveLength(0);
  });

  it('the bridge is registered for the price-list entity type', () => {
    const registry = h.container.resolve('salesChannelBridgeRegistry') as {
      require(type: string): { table: string; entityIdColumn: string; emptyMeansEveryChannel?: boolean };
    };
    const bridge = registry.require('price-list');
    expect(bridge.table).toBe('sales_channel_price_lists');
    expect(bridge.entityIdColumn).toBe('price_list_id');
    expect(bridge.emptyMeansEveryChannel ?? false).toBe(false);
  });

  it('rows carry a variant, a signed percent and an amount adjustment, under shape CHECKs', async () => {
    const id = await insertBook();
    const insertRow = (fields: Record<string, unknown>) => {
      const row = { id: randomUUID(), price_list_id: id, min_quantity: 1, ...fields };
      const columns = Object.keys(row);
      return sql(
        `insert into "price_list_matrix_entries" (${columns.map((c) => `"${c}"`).join(', ')}, "created_at", "updated_at")
         values (${columns.map(() => '?').join(', ')}, now(), now())`,
        Object.values(row),
      );
    };
    // A product row with no organization — the 148 refusal is gone.
    await insertRow({ product_id: SEED_PRODUCT_101_ID, price_type: 'fixed', amount: '10' });
    await insertRow({ category_id: null, price_type: 'percent', percent: '-12.5' });
    await insertRow({ product_id: SEED_PRODUCT_101_ID, price_type: 'amount', amount: '-3.5' });
    await insertRow({ product_id: SEED_PRODUCT_101_ID, price_type: 'percent', percent: '1000' });
    await expect(insertRow({ price_type: 'percent', percent: '-100.01' })).rejects.toThrow(/price_check/);
    await expect(insertRow({ price_type: 'percent', percent: '1000.01' })).rejects.toThrow(/price_check|numeric/);
    await expect(insertRow({ price_type: 'fixed', amount: '10' })).rejects.toThrow(/price_check/);
    await expect(insertRow({ product_id: SEED_PRODUCT_101_ID, price_type: 'fixed', amount: '-1' })).rejects.toThrow(
      /price_check/,
    );
    const [variant] = await sql<{ id: string; product_id: string }>(
      `select "id", "parent_product_id" as "product_id" from "product_variants" limit 1`,
    );
    if (variant) {
      await insertRow({ variant_id: variant.id, product_id: variant.product_id, price_type: 'percent', percent: '10' });
      await expect(
        insertRow({ variant_id: variant.id, price_type: 'percent', percent: '10' }),
      ).rejects.toThrow(/variant_check/);
    }
    await sql(`delete from "price_lists" where "id" = ?`, [id]);
    expect(await sql(`select 1 from "price_list_matrix_entries" where "price_list_id" = ?`, [id])).toHaveLength(0);
  });

  it('installs precedence version 1 = HY, active, category before attribute, depth within the cell', async () => {
    const rows = await sql<{
      version: number;
      cells: string[];
      category_before_attribute: boolean;
      depth_mode: string;
      state: string;
    }>(`select "version", "cells", "category_before_attribute", "depth_mode", "state" from "price_list_precedence" order by "version"`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      version: 1,
      cells: [
        'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute',
        'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute',
        'org.all', 'group.all',
      ],
      category_before_attribute: true,
      depth_mode: 'within_cell',
      state: 'active',
    });
    await expect(
      sql(
        `insert into "price_list_precedence" ("version", "cells", "category_before_attribute", "depth_mode", "state", "created_at")
         values (2, '[]'::jsonb, true, 'within_cell', 'active', now())`,
      ),
    ).rejects.toThrow(/price_list_precedence_one_active/);
  });

  it('creates the price-surface tables', async () => {
    const tables = await sql<{ table_name: string }>(
      `select "table_name" from information_schema.tables
        where "table_schema" = current_schema() and "table_name" in ('price_profiles', 'price_profile_prices')
        order by "table_name"`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(['price_profile_prices', 'price_profiles']);
  });
});
