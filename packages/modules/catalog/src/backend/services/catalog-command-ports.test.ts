import { describe, expect, it, vi } from 'vitest';
import type {
  CatalogAttributeCommandPort,
  CatalogProductCommandPort,
  ProductScopedWriteCell,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import {
  createCatalogAttributeCommandPort,
  createCatalogProductCommandPort,
  type CatalogAttributeCommandAdmin,
  type CatalogProductCommandAdmin,
} from './catalog-command-ports.js';
import { createCatalogProductScopeWritePort, createCatalogProductWritePort } from './catalog-write-ports.js';

/**
 * `specs/186-aggregate-ports/` T071–T074 (issue #1825) — what the two catalog
 * aggregate ports add to the service methods the admin routes call, without a
 * database: `source` refused before anything runs, the caller's options handed
 * to the service method as the Command's caller options, `expectedVersion` as
 * the editor version the `PATCH` takes, the scoped write's Command and its
 * call-level refusals, and the deprecated ports delegating. The writes
 * themselves are `[PG]`: `backend/test/contract/catalog/catalog-product-command-port.test.ts`.
 */
const P1 = '00000000-0000-4000-8000-0000000000a1';
const V1 = '00000000-0000-4000-8000-0000000000b1';
const now = new Date('2026-11-26T00:00:00Z');

const product = (id = P1) =>
  ({
    id,
    sku: 'SKU-1',
    slug: 'sku-1',
    type: 'simple',
    status: 'inactive',
    name: 'Drill',
    description: '',
    visibility: 'public',
    attributeValues: {},
    allowedOrganizationIds: [],
    attributeSetId: null,
    createdAt: now,
    updatedAt: now,
  }) as never;
const variant = () =>
  ({ id: V1, parentProductId: P1, sku: 'SKU-1-V', variantAttributeValues: {}, stockLevel: 0, createdAt: now, updatedAt: now }) as never;

function productAdmin(): { admin: CatalogProductCommandAdmin; calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const record =
    <R>(name: string, result: R) =>
    async (...args: unknown[]): Promise<R> => {
      (calls[name] ??= []).push(args);
      return result;
    };
  const admin: CatalogProductCommandAdmin = {
    createProduct: record('createProduct', product()),
    updateProductAudited: record('updateProductAudited', product()),
    archiveProduct: record('archiveProduct', { product: product(), changed: true }),
    restoreProduct: record('restoreProduct', { product: product(), changed: true }),
    deleteProduct: record('deleteProduct', undefined),
    createVariant: record('createVariant', variant()),
    updateVariant: record('updateVariant', variant()),
    deleteVariant: record('deleteVariant', undefined),
    setAttributeValues: record('setAttributeValues', product()),
  };
  return { admin, calls };
}

function attributeAdmin(): { admin: CatalogAttributeCommandAdmin; calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const record =
    <R>(name: string, result: R) =>
    async (...args: unknown[]): Promise<R> => {
      (calls[name] ??= []).push(args);
      return result;
    };
  const admin: CatalogAttributeCommandAdmin = {
    createAttribute: record('createAttribute', { id: 'a' } as never),
    updateAttributeByIdOrKey: record('updateAttributeByIdOrKey', { id: 'a' } as never),
    deleteAttribute: record('deleteAttribute', undefined),
    addAttributeOption: record('addAttributeOption', { id: 'o' } as never),
    patchAttributeOption: record('patchAttributeOption', { id: 'o' } as never),
    removeAttributeOption: record('removeAttributeOption', undefined),
  };
  return { admin, calls };
}

const caller = { source: 'pim_akeneo', extensions: undefined };
const cell = (field: string): ProductScopedWriteCell =>
  ({ scope: { level: 'global' }, field, op: { op: 'set', value: 'x' } }) as ProductScopedWriteCell;

function productPort(admin: CatalogProductCommandAdmin, run = vi.fn()): CatalogProductCommandPort {
  return createCatalogProductCommandPort({
    admin: () => admin,
    commandBus: () => ({ run }) as never,
    importDeps: () => ({}) as never,
  });
}

describe('catalogProductCommandPort — the routes’ service methods, with the caller’s options', () => {
  it('hands each method’s source and extensions to the service method the route calls', async () => {
    const { admin, calls } = productAdmin();
    const port = productPort(admin);
    const options = { source: 'pim_akeneo' };
    await port.create({ sku: 'SKU-1' } as never, options);
    await port.archive(P1, options);
    await port.restore(P1, options);
    await port.delete(P1, options);
    await port.createVariant(P1, { sku: 'V' } as never, options);
    await port.updateVariant(P1, V1, { stockLevel: 1 }, options);
    await port.deleteVariant(P1, V1, options);

    expect(calls['createProduct']).toEqual([[{ sku: 'SKU-1' }, undefined, caller]]);
    expect(calls['archiveProduct']).toEqual([[P1, caller]]);
    expect(calls['restoreProduct']).toEqual([[P1, caller]]);
    expect(calls['deleteProduct']).toEqual([[P1, undefined, caller]]);
    expect(calls['createVariant']).toEqual([[P1, { sku: 'V' }, caller]]);
    expect(calls['updateVariant']).toEqual([[P1, V1, { stockLevel: 1 }, caller]]);
    expect(calls['deleteVariant']).toEqual([[P1, V1, caller]]);
  });

  it('runs update without the completeness gate, the version as the PATCH’s editor version', async () => {
    const { admin, calls } = productAdmin();
    const port = productPort(admin);
    await port.update(P1, { name: 'Renamed' }, { expectedVersion: 7 });
    await port.update(P1, { name: 'Again' });
    expect(calls['updateProductAudited']).toEqual([
      [P1, { name: 'Renamed', version: '7' }, undefined, { source: undefined, extensions: undefined }],
      [P1, { name: 'Again' }, undefined, { source: undefined, extensions: undefined }],
    ]);
  });

  it('passes the merge and the version to the attribute-value write', async () => {
    const { admin, calls } = productAdmin();
    const merge = async (current: Record<string, unknown>) => ({ ...current, color: 'red' });
    await productPort(admin).setCustomFieldValues(P1, merge, { expectedVersion: 3, source: 'erp' });
    expect(calls['setAttributeValues']).toEqual([[P1, merge, '3', { source: 'erp', extensions: undefined }]]);
  });

  it('refuses a malformed source or version before the service is called', async () => {
    const { admin, calls } = productAdmin();
    const port = productPort(admin);
    for (const write of [
      () => port.create({ sku: 'SKU-1' } as never, { source: 'Not A Code' }),
      () => port.delete(P1, { source: '' }),
      () => port.update(P1, { name: 'x' }, { expectedVersion: -1 }),
      () => port.update(P1, { name: 'x' }, { expectedVersion: 1.5 }),
      () => port.setCustomFieldValues(P1, async (c) => c, { expectedVersion: Number.NaN }),
    ]) {
      await expect(write()).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual({});
  });

  it('applyScopedValues runs product.scoped_values.import with the source and the extensions', async () => {
    const run = vi.fn(async (command: Command<unknown>) => {
      expect(command.action).toBe('product.scoped_values.import');
      expect(command.objectId).toBe(P1);
      expect(command.extensions).toEqual({ some_module: { a: 1 } });
      return { applied: 1, refused: [], urlKeys: [], changedFields: ['name'] };
    });
    const port = productPort(productAdmin().admin, run);
    const result = await port.applyScopedValues(
      P1,
      { cells: [cell('name')] },
      { source: 'pim_akeneo', extensions: { some_module: { a: 1 } } },
    );
    expect(result).toEqual({ applied: 1, refused: [], urlKeys: [] });
    expect(run).toHaveBeenCalledOnce();
  });

  it('applyScopedValues refuses the call — source, cap, duplicates — before any Command runs', async () => {
    const run = vi.fn();
    const port = productPort(productAdmin().admin, run);
    await expect(port.applyScopedValues(P1, { cells: [cell('name')] }, { source: 'Bad Source' })).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(port.applyScopedValues(P1, { cells: [cell('name'), cell('name')] })).rejects.toMatchObject({
      statusCode: 422,
      details: { field: 'cells', index: 1 },
    });
    await expect(
      port.applyScopedValues(P1, { cells: Array.from({ length: 2001 }, (_, i) => cell(`attribute:k${i}`)) }),
    ).rejects.toMatchObject({ statusCode: 422, details: { field: 'cells' } });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('catalogAttributeCommandPort — the attribute routes’ service methods', () => {
  it('hands the caller’s options to each method, and refuses a malformed source first', async () => {
    const { admin, calls } = attributeAdmin();
    const port: CatalogAttributeCommandPort = createCatalogAttributeCommandPort({ admin: () => admin });
    const options = { source: 'pim_unopim' };
    const opt = { source: 'pim_unopim', extensions: undefined };
    await port.create({ key: 'color' } as never, options);
    await port.update('color', { isSearchable: true } as never, options);
    await port.delete('color', options);
    await port.addOption('color', { value: 'red', labelDefault: 'Red' }, options);
    await port.updateOption('o1', { labelDefault: 'Rot' }, options);
    await port.deleteOption('o1', options);
    expect(calls['createAttribute']).toEqual([[{ key: 'color' }, opt]]);
    expect(calls['updateAttributeByIdOrKey']).toEqual([['color', { isSearchable: true }, undefined, opt]]);
    expect(calls['deleteAttribute']).toEqual([['color', opt]]);
    expect(calls['addAttributeOption']).toEqual([['color', { value: 'red', labelDefault: 'Red' }, opt]]);
    expect(calls['patchAttributeOption']).toEqual([['o1', { labelDefault: 'Rot' }, opt]]);
    expect(calls['removeAttributeOption']).toEqual([['o1', opt]]);

    await expect(port.delete('color', { source: 'X' })).rejects.toMatchObject({ statusCode: 422 });
    expect(calls['deleteAttribute']).toHaveLength(1);
  });
});

describe('the deprecated ports delegate (0.113.0)', () => {
  function fakePorts() {
    const products = {
      create: vi.fn(async () => ({ id: P1 })),
      update: vi.fn(async () => ({ id: P1 })),
      createVariant: vi.fn(async () => ({ id: V1 })),
      updateVariant: vi.fn(async () => ({ id: V1 })),
      deleteVariant: vi.fn(async () => undefined),
      applyScopedValues: vi.fn(async () => ({ applied: 1, refused: [], urlKeys: [] })),
    } as unknown as CatalogProductCommandPort;
    const attributes = {
      create: vi.fn(async () => ({ id: 'a' })),
      update: vi.fn(async () => ({ id: 'a' })),
      addOption: vi.fn(async () => ({ id: 'o' })),
      updateOption: vi.fn(async () => ({ id: 'o' })),
    } as unknown as CatalogAttributeCommandPort;
    return { products, attributes };
  }

  it('catalogProductWritePort: each write is the command port’s, the version moved into the options', async () => {
    const { products, attributes } = fakePorts();
    const port = createCatalogProductWritePort({
      products: () => products,
      attributes: () => attributes,
      attributeReads: () => ({ listAttributes: async () => [], listAttributesByFlag: async () => [] }),
    });
    await port.createProduct({ sku: 'S' } as never, { actorAdminUserId: 'ignored' });
    await port.updateProduct(P1, { name: 'N', version: '12' });
    await port.updateProduct(P1, { name: 'M' });
    await port.createVariant(P1, { sku: 'V' } as never);
    await port.updateVariant(P1, V1, { stockLevel: 2 });
    await port.deleteVariant(P1, V1);
    await port.createAttribute({ key: 'k' } as never);
    await port.updateAttributeByIdOrKey('k', { isSearchable: true } as never);
    await port.addAttributeOption('k', { value: 'v', labelDefault: 'V' });
    await port.patchAttributeOption('o', { sortOrder: 2 });

    expect(products.create).toHaveBeenCalledWith({ sku: 'S' });
    expect(products.update).toHaveBeenNthCalledWith(1, P1, { name: 'N' }, { expectedVersion: 12 });
    expect(products.update).toHaveBeenNthCalledWith(2, P1, { name: 'M' }, {});
    expect(products.createVariant).toHaveBeenCalledWith(P1, { sku: 'V' });
    expect(products.updateVariant).toHaveBeenCalledWith(P1, V1, { stockLevel: 2 });
    expect(products.deleteVariant).toHaveBeenCalledWith(P1, V1);
    expect(attributes.create).toHaveBeenCalledWith({ key: 'k' });
    expect(attributes.update).toHaveBeenCalledWith('k', { isSearchable: true });
    expect(attributes.addOption).toHaveBeenCalledWith('k', { value: 'v', labelDefault: 'V' });
    expect(attributes.updateOption).toHaveBeenCalledWith('o', { sortOrder: 2 });
  });

  it('catalogProductWritePort.updateProduct: a malformed version token is refused 422, nothing written', async () => {
    const { admin, calls } = productAdmin();
    const products = productPort(admin);
    const port = createCatalogProductWritePort({
      products: () => products,
      attributes: () => ({}) as never,
      attributeReads: () => ({ listAttributes: async () => [], listAttributesByFlag: async () => [] }),
    });
    for (const version of ['', '0x1F', ' 7 ', '1e3', '-1']) {
      await expect(port.updateProduct(P1, { name: 'N', version } as never), version).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_FAILED',
      });
    }
    expect(calls).toEqual({});
    await port.updateProduct(P1, { name: 'N', version: '42' });
    expect(calls['updateProductAudited']).toEqual([[P1, { name: 'N', version: '42' }, undefined, { source: undefined, extensions: undefined }]]);
  });

  it('catalogProductScopeWritePort: the registered-module rule, then applyScopedValues with the source', async () => {
    const { products } = fakePorts();
    const port = createCatalogProductScopeWritePort({
      products: () => products,
      isRegisteredModule: (id) => id === 'pim_connector',
    });
    await expect(port.applyScopes(P1, { cells: [cell('name')] }, { source: 'pim_connector' })).resolves.toEqual({
      applied: 1,
      refused: [],
      urlKeys: [],
    });
    expect(products.applyScopedValues).toHaveBeenCalledWith(P1, { cells: [cell('name')] }, { source: 'pim_connector' });
    await expect(port.applyScopes(P1, { cells: [cell('name')] }, { source: 'not_registered' })).rejects.toMatchObject({
      statusCode: 422,
      details: { field: 'source' },
    });
    expect(products.applyScopedValues).toHaveBeenCalledOnce();
  });
});
