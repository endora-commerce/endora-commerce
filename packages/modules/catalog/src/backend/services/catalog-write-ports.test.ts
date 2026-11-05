import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  integrationWritableField,
  type CreateProductRequest,
  type ProductScopedWriteCell,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { createCatalogProductScopeWritePort, createCatalogProductWritePort } from './catalog-write-ports.js';
import { assertIntegrationCall, firstDuplicateCell } from './scoped-values-import.js';
import { CatalogAdminService, type CatalogEventBus } from './catalog-admin.service.js';
import type { CatalogAttributeReadService, CatalogAttributeView } from './catalog-attribute-read.service.js';

/**
 * Feature 174 (T083; `contracts/pim-locale-mapping.md` §4, R13a, R21) — the pieces of the connector
 * port v2 that need no database: the allowlist, the call-level refusals (source, cap, duplicates)
 * raised before any Command runs. The writes themselves are `[PG]`:
 * `backend/test/contract/catalog/scope-write-port-v2.test.ts`.
 */
const C1 = '00000000-0000-4000-8000-0000000000c1';
const ITEM = '00000000-0000-4000-8000-0000000000a1';

describe('integrationWritableField (R13a)', () => {
  it('accepts the allowlist', () => {
    for (const field of [
      'name',
      'description',
      'urlKey',
      'status',
      'window',
      'attribute:colour',
      `gallery:${ITEM}:altText`,
      `attachment:${ITEM}:name`,
      `attachment:${ITEM}:description`,
      `packagingUnit:${ITEM}:name`,
    ]) {
      expect(integrationWritableField(field), field).toBe(true);
    }
  });

  it('refuses audience, product.*, seo:*, galleryRole:*, hidden flags, MOQ and returnable', () => {
    for (const field of [
      'audience',
      'product.sku',
      'seo:title',
      'galleryRole:base_image',
      `gallery:${ITEM}:hidden`,
      `attachment:${ITEM}:hidden`,
      'minOrderQuantity',
      'returnable',
    ]) {
      expect(integrationWritableField(field), field).toBe(false);
    }
  });
});

describe('assertIntegrationCall (R21)', () => {
  const cell = (field: string, scope: ProductScopedWriteCell['scope'] = { level: 'global' }): ProductScopedWriteCell =>
    ({ scope, field, op: { op: 'set', value: 'x' } }) as ProductScopedWriteCell;
  const registered = (id: string) => id === 'pim_connector';

  it('passes a registered source with distinct cells', () => {
    expect(() =>
      assertIntegrationCall([cell('name'), cell('name', { level: 'channel', channelId: C1 })], 'pim_connector', registered),
    ).not.toThrow();
  });

  it('refuses a source that is not a registered module id', () => {
    for (const source of ['unknown_module', 'Pim Connector', '', 'a']) {
      expect(() => assertIntegrationCall([cell('name')], source, registered)).toThrow(
        expect.objectContaining({ statusCode: 422, code: 'VALIDATION_FAILED', details: { field: 'source' } }),
      );
    }
  });

  it('refuses more than 2 000 cells and a (field, scope) twice; languages compare case-insensitively', () => {
    const many = Array.from({ length: 2001 }, (_, i) => cell(`attribute:k${i}`));
    expect(() => assertIntegrationCall(many, 'pim_connector', registered)).toThrow(
      expect.objectContaining({ statusCode: 422, details: { field: 'cells' } }),
    );
    const pl = (languageCode: string) => cell('name', { level: 'channel_language', channelId: C1, languageCode });
    expect(firstDuplicateCell([pl('pl-PL'), pl('en-US'), pl('PL-pl')])).toBe(2);
    expect(() => assertIntegrationCall([pl('pl-PL'), pl('pl-pl')], 'pim_connector', registered)).toThrow(
      expect.objectContaining({ statusCode: 422, details: { field: 'cells', index: 1 } }),
    );
  });

  it('the port refuses the call before any Command runs', async () => {
    const run = vi.fn();
    const port = createCatalogProductScopeWritePort({
      commandBus: () => ({ run }) as never,
      importDeps: () => ({}) as never,
      isRegisteredModule: registered,
    });
    await expect(port.applyScopes(ITEM, { cells: [cell('name')] }, { source: 'not_registered' })).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(run).not.toHaveBeenCalled();
  });
});

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-014, FR-042 inbound,
 * research R-7) — a Page Builder content attribute's value is authored on the
 * product content screen only. The write port a connector uses refuses a
 * content key in `attributeValues` before anything is written: no transaction
 * is opened and no row is read.
 */
describe('createCatalogProductWritePort — content attribute keys (feature 172)', () => {
  const view = (key: string, valueType: string): CatalogAttributeView =>
    ({ id: `ext-${key}`, customFieldDefinitionId: `def-${key}`, key, valueType }) as unknown as CatalogAttributeView;

  function port() {
    const untouched = (): never => {
      throw new Error('the refusal must come before any read or write');
    };
    const service = new CatalogAdminService(
      untouched as unknown as () => EntityManager,
      { emit: untouched } as unknown as CatalogEventBus,
      undefined,
      undefined,
      { run: untouched } as never,
      {
        listAll: async () => [view('buying_guide', 'page_builder'), view('color', 'enum')],
      } as unknown as CatalogAttributeReadService,
    );
    return createCatalogProductWritePort(() => service);
  }

  async function refusal(promise: Promise<unknown>): Promise<HttpError> {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }

  it('refuses a content key on createProduct, naming it', async () => {
    const error = await refusal(
      port().createProduct({
        sku: 'PIM-1',
        type: 'simple',
        name: 'Drill',
        description: '',
        categoryIds: [],
        attributeValues: { color: 'red', buying_guide: '<p>Guide</p>' },
        visibility: 'public',
      } as unknown as CreateProductRequest),
    );
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('ATTRIBUTE_VALUE_REJECTED');
    expect(error.details).toEqual([
      { path: 'attributeValues.buying_guide', issue: 'Page Builder content is edited on the product content screen' },
    ]);
  });

  it('refuses a content key on updateProduct, naming it', async () => {
    const error = await refusal(
      port().updateProduct('00000000-0000-4000-8000-0000000000p1', {
        attributeValues: { buying_guide: { languages: {} } },
      }),
    );
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('ATTRIBUTE_VALUE_REJECTED');
    expect((error.details as Array<{ path: string }>).map((detail) => detail.path)).toEqual([
      'attributeValues.buying_guide',
    ]);
  });
});
