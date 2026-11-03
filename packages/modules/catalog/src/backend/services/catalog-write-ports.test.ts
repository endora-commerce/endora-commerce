import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CreateProductRequest } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  createCatalogProductScopeWritePort,
  createCatalogProductWritePort,
  toScopesPatch,
} from './catalog-write-ports.js';
import { CatalogAdminService, type CatalogEventBus } from './catalog-admin.service.js';
import type { CatalogAttributeReadService, CatalogAttributeView } from './catalog-attribute-read.service.js';
import type { ProductScopesService } from './product-scopes.service.js';
import type { UrlKeyService } from './url-key.service.js';

/**
 * Feature 163 (T122, FR-091), on the 170 v2 cells (170-shim until T083): a connector's status and
 * window cells become the scopes PATCH body with only the scopes they name, a C×L URL key goes to
 * the URL-key import mode, and every other family is refused `not_supported`.
 */
const B2B = '00000000-0000-4000-8000-0000000000c1';
const B2C = '00000000-0000-4000-8000-0000000000c2';

describe('toScopesPatch', () => {
  it('groups by channel and names only what the cells name, in the write encoding', () => {
    const { request, refused } = toScopesPatch({
      cells: [
        { scope: { level: 'channel', channelId: B2B }, field: 'status', op: { op: 'set', value: 'inactive' } },
        { scope: { level: 'channel_language', channelId: B2B, languageCode: 'pl-PL' }, field: 'status', op: { op: 'inherit' } },
        { scope: { level: 'channel', channelId: B2C }, field: 'returnable', op: { op: 'set', value: false } },
      ],
    });
    expect(request).toEqual({
      channels: [{ channelId: B2B, status: 'inactive', languageStatuses: [{ languageCode: 'pl-PL', status: { inherit: true } }] }],
    });
    expect(refused).toEqual([{ scope: { level: 'channel', channelId: B2C }, field: 'returnable', code: 'not_supported' }]);
  });

  it('maps the Global window to `global` and a channel window to the channel entry', () => {
    const { request } = toScopesPatch({
      cells: [
        { scope: { level: 'global' }, field: 'window', op: { op: 'set', value: { from: '2026-11-01T00:00:00.000Z', until: null } } },
        { scope: { level: 'channel', channelId: B2B }, field: 'window', op: { op: 'inherit' } },
      ],
    });
    expect(request).toEqual({
      channels: [{ channelId: B2B, window: { inherit: true } }],
      global: { publishFrom: '2026-11-01T00:00:00.000Z', publishUntil: null },
    });
  });

  it('is an empty write for no cells; a C×L key goes to the URL-key writes', () => {
    expect(toScopesPatch({ cells: [] })).toEqual({ request: { channels: [] }, urlKeys: [], refused: [] });
    const { urlKeys } = toScopesPatch({
      cells: [{ scope: { level: 'channel_language', channelId: B2B, languageCode: 'pl-PL' }, field: 'urlKey', op: { op: 'set', value: 'drill' } }],
    });
    expect(urlKeys).toEqual([{ channelId: B2B, languageCode: 'pl-PL', key: 'drill' }]);
  });
});

describe('createCatalogProductScopeWritePort (checkpoint C code review, N2; A-6)', () => {
  it('runs the write alone, with no completeness mode, and reads nothing back', async () => {
    const calls: unknown[][] = [];
    const scopes = {
      writeStatus: async (...args: unknown[]) => {
        calls.push(args);
        return { changedFields: ['scopedStatus'], warnings: [] };
      },
      apply: async () => {
        throw new Error('the port must not read the scopes back');
      },
    } as unknown as ProductScopesService;
    const port = createCatalogProductScopeWritePort(() => scopes, () => ({}) as UrlKeyService);
    const result = await port.applyScopes(
      'p-1',
      { cells: [{ scope: { level: 'channel', channelId: B2B }, field: 'status', op: { op: 'set', value: 'active' } }] },
      { source: 'pim' },
    );
    expect(calls).toEqual([['p-1', { channels: [{ channelId: B2B, status: 'active' }] }]]);
    expect(result).toEqual({ applied: 1, refused: [], urlKeys: [] });
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
        name: { 'en-US': 'Drill' },
        description: { 'en-US': '' },
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
