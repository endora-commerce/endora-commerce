import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { SupportedEntityType } from '@endora-commerce/contracts';
import {
  CustomFieldValueService,
  type DefinitionSource,
} from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-value.service.js';

/**
 * Feature 061 T003 — the change-guard probes (`hasStoredValues` / `isOptionInUse`)
 * interpolate a per-entity `{table, column}` storage binding
 * (contracts/custom-fields-product-host.md §2, research §R9).
 *
 * The `product` host stores its values in `products.attribute_values`; every
 * pre-existing host keeps probing its own table's `custom_field_values` column.
 * No DB — the EM connection is stubbed and the emitted SQL is asserted.
 */

const NO_DEFS: DefinitionSource = { listForEntity: async () => [] };

interface ProbeCall {
  sql: string;
  params: unknown[];
}

function fakeEm(rows: unknown[] = []): { em: EntityManager; calls: ProbeCall[] } {
  const calls: ProbeCall[] = [];
  const em = {
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return rows;
      },
    }),
  } as unknown as EntityManager;
  return { em, calls };
}

function svc(): CustomFieldValueService {
  return new CustomFieldValueService(NO_DEFS);
}

describe('hasStoredValues — per-entity {table, column} binding', () => {
  it('probes products.attribute_values for the product host', async () => {
    const { em, calls } = fakeEm();
    await svc().hasStoredValues(em, 'product', 'color');
    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0]!;
    expect(sql).toContain('from "products"');
    expect(sql).toContain('jsonb_exists("attribute_values"');
    expect(sql).not.toContain('custom_field_values');
    expect(sql).not.toContain('undefined');
    expect(params).toEqual(['color']);
  });

  it.each<[SupportedEntityType, string]>([
    ['category', 'categories'],
    ['order', 'orders'],
    ['organization', 'organizations'],
    ['customer', 'customer_accounts'],
    ['quote_request', 'quote_requests'],
  ])('still probes %s → %s.custom_field_values', async (entityType, table) => {
    const { em, calls } = fakeEm();
    await svc().hasStoredValues(em, entityType, 'some_key');
    const { sql } = calls[0]!;
    expect(sql).toContain(`from "${table}"`);
    expect(sql).toContain('jsonb_exists("custom_field_values"');
    expect(sql).not.toContain('undefined');
  });

  it('returns true when a row exists and false when none does', async () => {
    const hit = fakeEm([{ one: 1 }]);
    await expect(svc().hasStoredValues(hit.em, 'product', 'color')).resolves.toBe(true);
    const miss = fakeEm([]);
    await expect(svc().hasStoredValues(miss.em, 'product', 'color')).resolves.toBe(false);
  });
});

describe('isOptionInUse — per-entity {table, column} binding', () => {
  it('probes products.attribute_values for the product host', async () => {
    const { em, calls } = fakeEm();
    await svc().isOptionInUse(em, 'product', 'color', 'red');
    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0]!;
    expect(sql).toContain('from "products"');
    expect(sql).toContain('"attribute_values"->>');
    expect(sql).toContain('jsonb_typeof("attribute_values"->');
    expect(sql).not.toContain('custom_field_values');
    expect(sql).not.toContain('undefined');
    expect(params).toEqual(['color', 'red', 'color', 'color', 'red']);
  });

  it('still probes an existing host table\'s custom_field_values column', async () => {
    const { em, calls } = fakeEm();
    await svc().isOptionInUse(em, 'organization', 'tier', 'gold');
    const { sql } = calls[0]!;
    expect(sql).toContain('from "organizations"');
    expect(sql).toContain('"custom_field_values"->>');
    expect(sql).not.toContain('attribute_values');
    expect(sql).not.toContain('undefined');
  });

  it('returns true when a row uses the option and false otherwise', async () => {
    const hit = fakeEm([{ one: 1 }]);
    await expect(svc().isOptionInUse(hit.em, 'product', 'color', 'red')).resolves.toBe(true);
    const miss = fakeEm([]);
    await expect(svc().isOptionInUse(miss.em, 'product', 'color', 'red')).resolves.toBe(false);
  });
});
