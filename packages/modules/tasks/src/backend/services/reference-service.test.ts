import { describe, expect, it, vi } from 'vitest';
import { TaskReferenceService } from './reference-service.js';

const READER = '00000000-0000-4000-8000-0000000000a1';
const PRODUCT = '00000000-0000-4000-8000-0000000000b1';

vi.mock('@endora-commerce/platform/tenancy', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/platform/tenancy')>(
    '@endora-commerce/platform/tenancy',
  );
  return {
    ...actual,
    getTenantContext: () => ({ mode: 'all', actor: { kind: 'admin', id: '00000000-0000-4000-8000-0000000000a1' } }),
  };
});

describe('TaskReferenceService — a mentioned Product (issue #963)', () => {
  it('is named by its Global name, without reading the acting administrator', async () => {
    const findById = vi.fn(async () => ({ id: READER, preferredLanguage: 'pl' }));
    const service = new TaskReferenceService({
      products: { findByIds: vi.fn(async () => [{ id: PRODUCT, name: 'Wiertarka' }]) } as never,
      orders: { findByIds: vi.fn(async () => []) } as never,
      adminUsers: { findByIds: vi.fn(async () => []), findById } as never,
      owners: { isPresent: () => false, labels: vi.fn(async () => new Map()) },
      tasks: vi.fn(async () => []),
      mayRead: {
        orders: async () => false,
        products: async () => true,
        quoteRequests: async () => false,
        opportunities: async () => false,
        projects: async () => false,
      },
    });
    expect(await service.resolve(`[[product:${PRODUCT}]]`)).toEqual([
      { type: 'product', id: PRODUCT, available: true, label: 'Wiertarka', url: `/catalog/products/${PRODUCT}` },
    ]);
    expect(findById).not.toHaveBeenCalled();
  });
});
