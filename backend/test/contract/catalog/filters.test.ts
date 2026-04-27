import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T046 — `GET /catalog/filters` returns only attributes where `isFilterable=true`.
 * Non-filterable ProductAttributes must never appear in the filter panel (FR-005).
 */

interface FilterDef {
  attributeKey: string;
  label: string;
  valueType: 'string' | 'number' | 'boolean' | 'enum' | 'date';
  options?: { value: string; label: string; count: number }[];
  range?: { min: number; max: number };
}

describe('GET /api/v1/catalog/filters — filterable attributes only', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the filterable attribute definitions', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: FilterDef[] };
    expect(Array.isArray(body.data)).toBe(true);
    // Seed data (T093) provisions 10 filterable attributes.
    expect(body.data.length).toBeGreaterThan(0);
    for (const f of body.data) {
      expect(typeof f.attributeKey).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(['string', 'number', 'boolean', 'enum', 'date']).toContain(f.valueType);
    }
  });

  it('excludes an attribute toggled to isFilterable=false', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: FilterDef[] };
    const keys = body.data.map((f) => f.attributeKey);
    // Seed data includes an attribute `internal_sku_notes` that is searchable but not filterable.
    expect(keys).not.toContain('internal_sku_notes');
  });
});
