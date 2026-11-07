import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #687 — the key half of `filter[attr.<key>]=<value>` is interpolated
 * into the Meilisearch filter expression (`attributes.<key> = "…"`), so the
 * route refuses a key that is not an attribute-key-shaped identifier before
 * either listing backend sees it. An attribute key is snake_case
 * (`createAttributeRequestSchema`), so `^[a-z0-9_]+$` admits every key that can
 * exist; a well-shaped key that is not a filterable attribute keeps its
 * `FILTER_NOT_ALLOWED`.
 */
describe('GET /api/v1/catalog/products — the attribute filter key (issue #687)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function list(rawKey: string): Promise<{ status: number; code: string | undefined }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?filter%5Battr.${encodeURIComponent(rawKey)}%5D=foo`,
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    const body = res.json() as { error?: { code: string } };
    return { status: res.statusCode, code: body.error?.code };
  }

  it.each([
    'x = 1 OR categorySlugs',
    'color)',
    'color"',
    'color OR attributes.secret',
    'Color',
    'a.b',
    'a-b',
  ])('refuses the hostile key %j with a 400 VALIDATION_FAILED', async (key) => {
    expect(await list(key)).toEqual({ status: 400, code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('keeps FILTER_NOT_ALLOWED for a well-shaped key that is not a filterable attribute', async () => {
    expect(await list('i687_no_such_attribute')).toEqual({
      status: 400,
      code: ERROR_CODES.FILTER_NOT_ALLOWED,
    });
  });
});
