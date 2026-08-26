import { describe, expect, it } from 'vitest';
import {
  CustomFieldDefinitionsCache,
  CUSTOM_FIELDS_CACHE_TTL_MS,
  type CachedDefinition,
} from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.js';

/**
 * Feature 055 (T037) — per-entity-type definition cache invalidation. Pure unit
 * test with an injected clock; no Redis, no DB.
 */
function stubDefs(n: number): CachedDefinition[] {
  return Array.from({ length: n }, () => ({
    definition: {} as CachedDefinition['definition'],
    options: [],
  }));
}

describe('CustomFieldDefinitionsCache', () => {
  it('caches per entity type and only loads on a miss', async () => {
    let calls = 0;
    const cache = new CustomFieldDefinitionsCache();
    const loader = async () => {
      calls += 1;
      return stubDefs(1);
    };
    await cache.getForEntity('organization', loader);
    await cache.getForEntity('organization', loader);
    expect(calls).toBe(1); // second read served from cache
  });

  it('reloads after a local invalidation', async () => {
    let calls = 0;
    const cache = new CustomFieldDefinitionsCache();
    const loader = async () => {
      calls += 1;
      return stubDefs(1);
    };
    await cache.getForEntity('order', loader);
    cache.invalidateLocal('order');
    await cache.getForEntity('order', loader);
    expect(calls).toBe(2);
  });

  it('reloads after the TTL fallback elapses', async () => {
    let calls = 0;
    let clock = 1000;
    const cache = new CustomFieldDefinitionsCache(undefined, () => clock);
    const loader = async () => {
      calls += 1;
      return stubDefs(1);
    };
    await cache.getForEntity('customer', loader);
    clock += CUSTOM_FIELDS_CACHE_TTL_MS + 1;
    await cache.getForEntity('customer', loader);
    expect(calls).toBe(2);
  });

  it('invalidates on a cross-process message for the named entity type', async () => {
    let calls = 0;
    const cache = new CustomFieldDefinitionsCache();
    const loader = async () => {
      calls += 1;
      return stubDefs(1);
    };
    await cache.getForEntity('quote_request', loader);
    cache.handleMessage(JSON.stringify({ entityType: 'quote_request' }));
    await cache.getForEntity('quote_request', loader);
    expect(calls).toBe(2);
  });

  it('clears all entries on a malformed message (fail-safe)', async () => {
    let calls = 0;
    const cache = new CustomFieldDefinitionsCache();
    const loader = async () => {
      calls += 1;
      return stubDefs(1);
    };
    await cache.getForEntity('category', loader);
    cache.handleMessage('not-json');
    await cache.getForEntity('category', loader);
    expect(calls).toBe(2);
  });
});
