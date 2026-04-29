import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T013 — contract test for the extended attribute types introduced in
 * feature 002. New API-level types: `multiselect`, `price`, `slider`. The
 * existing `input`/`number`/`select` aliases must still work (mapped to
 * the appropriate DB representation per data-model.md §1.2 / research R-7).
 *
 * Per Constitution Principle III: written FIRST, fails for the right
 * reason. The schema in `packages/contracts/src/catalog.ts` still requires
 * `valueType` from the foundation 001 enum, so requests with the new
 * `type` field (and no `valueType`) get rejected with 400 VALIDATION_FAILED
 * by Zod. T021 (`update product-attribute schema`) and T022 (mapping impl)
 * turn these reds green.
 */

describe('Admin Attributes contract — feature 002 extended types (T013)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('POST accepts type=input as the API alias for the legacy `string` valueType', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'sku_notes_v002',
        label: { 'en-US': 'SKU notes' },
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST accepts type=multiselect with enumValues', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'compatible_systems_v002',
        label: { 'en-US': 'Compatible systems' },
        type: 'multiselect',
        enumValues: ['windows', 'macos', 'linux'],
        isSearchable: true,
        isFilterable: true,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { type: string; enumValues: string[]; displayAsSlider: boolean };
    };
    expect(body.data.type).toBe('multiselect');
    expect(body.data.enumValues).toEqual(['windows', 'macos', 'linux']);
    expect(body.data.displayAsSlider).toBe(false);
  });

  it('POST rejects multiselect with no enumValues (ENUM_VALUES_REQUIRED)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'broken_multiselect_v002',
        label: { 'en-US': 'Broken multiselect' },
        type: 'multiselect',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    // Either VALIDATION_FAILED (Zod refine) or a dedicated ENUM_VALUES_REQUIRED.
    // Both are acceptable; the spec's preference is the dedicated code so
    // clients can distinguish enumValues-missing from a generic validation
    // failure. T021/T022 should land the dedicated code.
    expect([
      ERROR_CODES.VALIDATION_FAILED,
      'ENUM_VALUES_REQUIRED' as string,
    ]).toContain(body.error.code);
  });

  it('POST accepts type=price', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'manufacturer_price_v002',
        label: { 'en-US': 'Manufacturer price' },
        type: 'price',
        isSearchable: false,
        isFilterable: true,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { type: string; displayAsSlider: boolean } };
    expect(body.data.type).toBe('price');
    expect(body.data.displayAsSlider).toBe(false);
  });

  it('POST accepts type=slider with numericKind=number', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'cross_section_v002',
        label: { 'en-US': 'Cross-section' },
        type: 'slider',
        numericKind: 'number',
        isSearchable: false,
        isFilterable: true,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { type: string; numericKind: 'number' | 'price' };
    };
    expect(body.data.type).toBe('slider');
    expect(body.data.numericKind).toBe('number');
  });

  it('POST rejects type=slider without numericKind (INVALID_DISPLAY_AS_SLIDER)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'broken_slider_v002',
        label: { 'en-US': 'Broken slider' },
        type: 'slider',
        isSearchable: false,
        isFilterable: true,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect([
      ERROR_CODES.VALIDATION_FAILED,
      'INVALID_DISPLAY_AS_SLIDER' as string,
    ]).toContain(body.error.code);
  });

  it('PATCH updates type and re-derives the underlying valueType + displayAsSlider', async () => {
    // Create as plain `number`.
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'flexible_value_v002',
        label: { 'en-US': 'Flexible value' },
        type: 'number',
        isSearchable: false,
        isFilterable: true,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    // Promote to slider with numericKind=number.
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${id}`,
      payload: { type: 'slider', numericKind: 'number' },
      cookies: adminCookie,
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as {
      data: { type: string; displayAsSlider: boolean };
    };
    expect(body.data.type).toBe('slider');
    expect(body.data.displayAsSlider).toBe(true);
  });
});
