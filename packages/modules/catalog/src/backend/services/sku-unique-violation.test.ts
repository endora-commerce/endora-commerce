import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { CatalogAdminService } from './catalog-admin.service.js';
import { isProductSkuUniqueViolation } from './sku-unique-violation.js';

/**
 * `specs/193-admin-form-extensions/` FR-112 — `product.create` and the scoped save are
 * hookable, so a hook module's writes share their transaction. Only the SKU index's
 * violation is a taken SKU; a hook's own unique violation passes through as itself.
 */

const violation = (constraint: string) =>
  new UniqueConstraintViolationException(Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: '23505', constraint }));

describe('isProductSkuUniqueViolation', () => {
  it('names the product SKU indexes only', () => {
    expect(isProductSkuUniqueViolation(violation('products_sku_live_unique'))).toBe(true);
    expect(isProductSkuUniqueViolation(violation('products_sku_unique'))).toBe(true);
    expect(isProductSkuUniqueViolation(violation('acme_pim_product_refs_erp_id_unique'))).toBe(false);
    expect(isProductSkuUniqueViolation(violation('products_slug_unique'))).toBe(false);
    expect(isProductSkuUniqueViolation(new Error('products_sku_live_unique'))).toBe(false);
  });
});

describe('createProduct — a unique violation inside the Command', () => {
  const create = (error: unknown) => {
    const bus = { run: async () => Promise.reject(error) } as unknown as CommandBus;
    const admin = new CatalogAdminService(() => ({}) as EntityManager, { emit: () => undefined } as never, undefined, undefined, bus);
    return admin.createProduct({ sku: 'SKU-1', type: 'simple', name: 'N', description: 'D', visibility: 'public', attributeValues: {}, categoryIds: [] } as never);
  };

  it('on the SKU index is 409 SKU_ALREADY_EXISTS', async () => {
    await expect(create(violation('products_sku_live_unique'))).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.SKU_ALREADY_EXISTS });
  });

  it('on any other constraint (a hook’s own table) propagates unchanged', async () => {
    const own = violation('acme_pim_product_refs_erp_id_unique');
    await expect(create(own)).rejects.toBe(own);
  });
});
