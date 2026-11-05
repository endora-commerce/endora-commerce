import type { ScopedFieldView, ScopedValuesData, ScopedValuesResponse } from '@endora-commerce/contracts';

/**
 * Feature 174 (`specs/174-product-editor-scope-switcher/` T023, `contracts/scoped-values-api.md`
 * §2) — a builder for `GET …/products/:id/scoped-values` answers, so editor tests mock the API in
 * its own shape. Every default is a Global answer of a simple product with no overrides; a test
 * names only what it is about. `scoped-values-fixtures.test.ts` holds it to the contract schema.
 */

const SET_ID = '00000000-0000-4000-8000-0000000000e1';

/** One field's view: `set` at the scope by default, every level, supported, optional. */
export function scopedField<T>(value: T | null, over: Partial<ScopedFieldView<T>> = {}): ScopedFieldView<T> {
  return {
    value,
    source: value === null ? 'absent' : 'set',
    levels: ['G', 'C', 'CL'],
    supportedHere: true,
    required: false,
    ...over,
  };
}

export function scopedValuesResponse(
  over: Partial<Omit<ScopedValuesData, 'fields'>> & { fields?: Partial<ScopedValuesData['fields']> } = {},
): ScopedValuesResponse {
  const { fields, ...rest } = over;
  const data: ScopedValuesData = {
    scope: { level: 'global' },
    version: '0',
    validScopes: { channels: [] },
    product: {
      sku: 'SKU-1',
      type: 'simple',
      attributeSetId: SET_ID,
      categoryIds: [],
      archivedAt: null,
      slugGlobal: 'drill',
      manageStock: true,
      backorderEnabled: false,
      lowStockThreshold: null,
      lowStockThresholdMode: 'cumulative',
      fulfilmentStrategy: null,
      fulfilmentStrategyWarehouseOrder: null,
      downloadAssetId: null,
      downloadUrl: null,
      allowedOrganizationIds: [],
    },
    fields: {
      name: scopedField('Drill', { required: true }),
      description: scopedField<string>(null),
      status: scopedField<'active' | 'inactive'>('active'),
      window: scopedField({ from: null, until: null }, { levels: ['G', 'C'] }),
      audience: scopedField({ visibility: 'public' as const, allowedOrganizationIds: [] }, { levels: ['G', 'C'] }),
      minOrderQuantity: scopedField<number>(null, { levels: ['G', 'C'] }),
      returnable: scopedField(false, { levels: ['G', 'C'] }),
      urlKey: scopedField('drill', { required: true }),
      ...fields,
    },
    attributes: [],
    gallery: {
      items: [],
      roles: { baseImage: scopedField<string>(null), smallImage: scopedField<string>(null), thumbnail: scopedField<string>(null) },
    },
    attachments: [],
    packagingUnits: [],
    seo: null,
    completeness: { level: 'global', incompleteScopes: 0 },
    organizations: [],
    ...rest,
  };
  return { data };
}
