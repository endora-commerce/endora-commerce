import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';

/**
 * Feature 161 (Checkpoint 6 review) — `price_lists:write` advises
 * `catalog:read` (D-175 `requires`, advisory). Adding product lines goes
 * through the catalogue's product browser and a product's variants through the
 * catalogue's admin variant read, both gated on `catalog:read`; a role writing
 * prices without it gets a grid whose *Add lines → Products* and *Show
 * variants* are absent. That the code exists is held by the permission
 * inventory (`backend/test/contract/admin_users/permission-inventory.test.ts`).
 */
describe('price_lists permission requirements', () => {
  it('advises catalog:read beside price_lists:write, and nothing beside price_lists:read', () => {
    const byCode = new Map((manifest.permissions ?? []).map((p) => [p.code, p]));
    expect(byCode.get('price_lists:write')?.requires).toEqual(['catalog:read']);
    expect(byCode.get('price_lists:read')?.requires).toBeUndefined();
  });
});
