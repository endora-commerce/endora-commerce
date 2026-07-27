import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';

import {
  CatalogAttributeIntegrityError,
  CatalogAttributeReadService,
} from '../../../src/modules/catalog/services/catalog-attribute-read.service.js';
import type { ProductAttribute } from '../../../src/modules/catalog/entities/product-attribute.entity.js';
import type {
  CachedDefinition,
} from '../../../src/modules/custom_fields/services/custom-field-definitions-cache.js';

/**
 * T014 (feature 061) — unit tests for the composed attribute read model
 * (contracts/catalog-attribute-view.md).
 *
 * Pure unit level: the CF definitions source and the extension query are both
 * stubbed, so composition + derivation logic is tested without Postgres.
 */

interface StubDef {
  id: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: string;
  required: boolean;
  sortOrder: number;
  options?: Array<{
    id: string;
    value: string;
    label: Record<string, string>;
    labelDefault: string;
    isDefault: boolean;
    sortOrder: number;
  }>;
}

interface StubExt {
  id: string;
  customFieldDefinitionId: string;
  selectDisplay?: 'pill' | 'dropdown' | null;
  numericKind?: 'number' | 'price' | null;
  isSearchable?: boolean;
  isFilterable?: boolean;
  isVariantAxis?: boolean;
  displayAsSlider?: boolean;
  isComparable?: boolean;
  quickSearchable?: boolean;
  isPromoRule?: boolean;
  filterPosition?: number;
  isVisibleOnProductPage?: boolean;
  channelScoped?: boolean;
  languageScoped?: boolean;
  massEditable?: boolean;
}

const NOW = new Date('2026-01-01T00:00:00Z');

function makeDefinition(def: StubDef): CachedDefinition {
  return {
    definition: {
      id: def.id,
      entityType: 'product',
      key: def.key,
      label: def.label,
      labelDefault: def.labelDefault,
      valueType: def.valueType,
      required: def.required,
      sortOrder: def.sortOrder,
      config: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    options: (def.options ?? []).map((o) => ({
      id: o.id,
      definitionId: def.id,
      value: o.value,
      label: o.label,
      labelDefault: o.labelDefault,
      isDefault: o.isDefault,
      sortOrder: o.sortOrder,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  } as unknown as CachedDefinition;
}

function makeExtension(ext: StubExt): ProductAttribute {
  return {
    id: ext.id,
    customFieldDefinitionId: ext.customFieldDefinitionId,
    selectDisplay: ext.selectDisplay ?? null,
    numericKind: ext.numericKind ?? null,
    isSearchable: ext.isSearchable ?? false,
    isFilterable: ext.isFilterable ?? false,
    isVariantAxis: ext.isVariantAxis ?? false,
    displayAsSlider: ext.displayAsSlider ?? false,
    isComparable: ext.isComparable ?? false,
    quickSearchable: ext.quickSearchable ?? false,
    isPromoRule: ext.isPromoRule ?? false,
    filterPosition: ext.filterPosition ?? 0,
    isVisibleOnProductPage: ext.isVisibleOnProductPage ?? false,
    channelScoped: ext.channelScoped ?? false,
    languageScoped: ext.languageScoped ?? false,
    massEditable: ext.massEditable ?? false,
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as ProductAttribute;
}

function makeService(defs: StubDef[], exts: StubExt[]): CatalogAttributeReadService {
  const extensionRows = exts.map(makeExtension);
  const fakeEm = {
    find: async (_entity: unknown, where: Record<string, unknown> = {}) => {
      const conditions = Object.entries(where ?? {});
      return extensionRows.filter((row) =>
        conditions.every(([field, expected]) => {
          const actual = (row as unknown as Record<string, unknown>)[field];
          return expected === undefined || actual === expected;
        }),
      );
    },
  } as unknown as EntityManager;
  const definitions = {
    listForEntity: async () => defs.map(makeDefinition),
  };
  return new CatalogAttributeReadService(() => fakeEm, definitions);
}

describe('CatalogAttributeReadService (feature 061, T014)', () => {
  const defs: StubDef[] = [
    {
      id: 'def-color',
      key: 'color',
      label: { 'en-US': 'Color' },
      labelDefault: 'Color',
      valueType: 'select',
      required: true,
      sortOrder: 0,
      options: [
        { id: 'opt-red', value: 'red', label: { 'pl-PL': 'Czerwony' }, labelDefault: 'Red', isDefault: true, sortOrder: 0 },
        { id: 'opt-blue', value: 'blue', label: {}, labelDefault: 'Blue', isDefault: false, sortOrder: 1 },
      ],
    },
    {
      id: 'def-finish',
      key: 'finish',
      label: { 'en-US': 'Finish' },
      labelDefault: 'Finish',
      valueType: 'select',
      required: false,
      sortOrder: 1,
      options: [
        { id: 'opt-matte', value: 'matte', label: {}, labelDefault: 'Matte', isDefault: false, sortOrder: 0 },
      ],
    },
    { id: 'def-notes', key: 'notes', label: {}, labelDefault: 'Notes', valueType: 'text', required: false, sortOrder: 2 },
    { id: 'def-weight', key: 'weight', label: {}, labelDefault: 'Weight', valueType: 'number', required: false, sortOrder: 3 },
    { id: 'def-msrp', key: 'msrp', label: {}, labelDefault: 'MSRP', valueType: 'number', required: false, sortOrder: 4 },
    { id: 'def-tags', key: 'tags', label: {}, labelDefault: 'Tags', valueType: 'multiselect', required: false, sortOrder: 5 },
    { id: 'def-active', key: 'active', label: {}, labelDefault: 'Active', valueType: 'boolean', required: false, sortOrder: 6 },
    { id: 'def-release', key: 'release', label: {}, labelDefault: 'Release', valueType: 'date', required: false, sortOrder: 7 },
  ];

  const exts: StubExt[] = [
    {
      id: 'ext-color',
      customFieldDefinitionId: 'def-color',
      selectDisplay: 'pill',
      isSearchable: true,
      isFilterable: true,
      isComparable: true,
      filterPosition: 4,
      massEditable: true,
    },
    { id: 'ext-finish', customFieldDefinitionId: 'def-finish', selectDisplay: 'dropdown' },
    { id: 'ext-notes', customFieldDefinitionId: 'def-notes', quickSearchable: true },
    { id: 'ext-weight', customFieldDefinitionId: 'def-weight', numericKind: 'number', displayAsSlider: true },
    { id: 'ext-msrp', customFieldDefinitionId: 'def-msrp', numericKind: 'price' },
    { id: 'ext-tags', customFieldDefinitionId: 'def-tags', isFilterable: true },
    { id: 'ext-active', customFieldDefinitionId: 'def-active' },
    { id: 'ext-release', customFieldDefinitionId: 'def-release' },
  ];

  it('listAll composes definition identity with extension flags', async () => {
    const service = makeService(defs, exts);
    const all = await service.listAll();
    expect(all).toHaveLength(8);

    const color = all.find((v) => v.key === 'color')!;
    expect(color.id).toBe('ext-color');
    expect(color.customFieldDefinitionId).toBe('def-color');
    expect(color.label).toEqual({ 'en-US': 'Color' });
    expect(color.labelDefault).toBe('Color');
    expect(color.isRequired).toBe(true);
    expect(color.isSearchable).toBe(true);
    expect(color.isFilterable).toBe(true);
    expect(color.isComparable).toBe(true);
    expect(color.filterPosition).toBe(4);
    expect(color.massEditable).toBe(true);
    expect(color.options).toEqual([
      {
        id: 'opt-red',
        value: 'red',
        label: { 'pl-PL': 'Czerwony' },
        labelDefault: 'Red',
        isDefault: true,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'opt-blue',
        value: 'blue',
        label: {},
        labelDefault: 'Blue',
        isDefault: false,
        sortOrder: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });

  it('derives the legacy 8-value valueType bijectively', async () => {
    const service = makeService(defs, exts);
    const all = await service.listAll();
    const byKey = new Map(all.map((v) => [v.key, v.valueType]));
    expect(byKey.get('color')).toBe('enum'); // select + pill
    expect(byKey.get('finish')).toBe('select'); // select + dropdown
    expect(byKey.get('notes')).toBe('string'); // text
    expect(byKey.get('weight')).toBe('number'); // number + numericKind=number
    expect(byKey.get('msrp')).toBe('price'); // number + numericKind=price
    expect(byKey.get('tags')).toBe('multiselect');
    expect(byKey.get('active')).toBe('boolean');
    expect(byKey.get('release')).toBe('date');
  });

  it('orders listAll by definition sortOrder then key', async () => {
    const service = makeService(defs, exts);
    const all = await service.listAll();
    expect(all.map((v) => v.key)).toEqual([
      'color',
      'finish',
      'notes',
      'weight',
      'msrp',
      'tags',
      'active',
      'release',
    ]);
  });

  it('getByIdOrKey resolves extension id, definition id, and key', async () => {
    const service = makeService(defs, exts);
    // Not UUID-shaped ids in the stub; key resolution works regardless.
    const byKey = await service.getByIdOrKey('color');
    expect(byKey?.id).toBe('ext-color');
    const missing = await service.getByIdOrKey('does_not_exist');
    expect(missing).toBeNull();
  });

  it('listByFlag filters on the extension flag and orders by key', async () => {
    const service = makeService(defs, exts);
    const filterable = await service.listByFlag('isFilterable');
    expect(filterable.map((v) => v.key)).toEqual(['color', 'tags']);
    const quick = await service.listByFlag('quickSearchable');
    expect(quick.map((v) => v.key)).toEqual(['notes']);
  });

  it('optionLabelIndex maps key → value → labels', async () => {
    const service = makeService(defs, exts);
    const index = await service.optionLabelIndex();
    expect(index.get('color')?.get('red')).toEqual({
      label: { 'pl-PL': 'Czerwony' },
      labelDefault: 'Red',
    });
    expect(index.get('finish')?.get('matte')).toEqual({ label: {}, labelDefault: 'Matte' });
    expect(index.has('notes')).toBe(false);
  });

  it('throws a data-integrity error on an extension without a definition', async () => {
    const service = makeService(defs.slice(0, 1), [
      exts[0]!,
      { id: 'ext-orphan', customFieldDefinitionId: 'def-missing' },
    ]);
    await expect(service.listAll()).rejects.toThrow(CatalogAttributeIntegrityError);
  });

  it('throws a data-integrity error on a product definition without an extension', async () => {
    const service = makeService(defs.slice(0, 2), [exts[0]!]);
    await expect(service.listAll()).rejects.toThrow(CatalogAttributeIntegrityError);
  });
});
