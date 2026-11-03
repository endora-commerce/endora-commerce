import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type {
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  RfqCustomerPort,
} from '@endora-commerce/contracts';

vi.mock('./order-line-order.js', () => ({
  loadArrangedOrderLines: async () => ({ lines: [{ productId: 'prod-1', variantId: null, quantity: 2 }] }),
}));

const { OrderCloneToQuoteService } = await import('./order-clone-to-quote-service.js');
const { OrderReorderService } = await import('./order-reorder-service.js');

/**
 * Issue #665 — the services a buyer reaches by order id resolve the order through
 * `OrderAccessService`, the rule the read applies, rather than through
 * `{ id, organizationId }`: a `regular_user` is pinned to the orders they placed,
 * an `organization_admin` is not. The scope belongs to the service, so no caller
 * can reach a colleague's order by forgetting a route-level check.
 */

const CTX = { customerAccountId: 'member-b', organizationId: 'org-1' };

function accounts(role: 'regular_user' | 'organization_admin'): CustomerAccountReadPort {
  return { findById: async (id: string) => ({ id, role, organizationId: 'org-1' }) } as unknown as CustomerAccountReadPort;
}

function emRecording(order: unknown) {
  const wheres: Array<Record<string, unknown>> = [];
  const em = {
    findOne: async (_entity: unknown, where: Record<string, unknown>) => {
      wheres.push(where);
      return order;
    },
    find: async () => [],
  };
  return { em: () => em as never, wheres };
}

describe('#665 — OrderCloneToQuoteService resolves the order through the read scope', () => {
  function rig(role: 'regular_user' | 'organization_admin', order: unknown = { id: 'order-1' }) {
    const createForCustomer = vi.fn(async (_ctx: unknown, _request: unknown, _options: unknown) => ({ id: 'rfq-1' }));
    const { em, wheres } = emRecording(order);
    const service = new OrderCloneToQuoteService(
      em,
      () => ({ createForCustomer }) as unknown as RfqCustomerPort,
      accounts(role),
    );
    return { service, createForCustomer, wheres };
  }

  it('pins a regular member to the orders they placed', async () => {
    const { service, wheres } = rig('regular_user');
    await service.clone('order-1', CTX);
    expect(wheres[0]).toEqual({ id: 'order-1', organizationId: 'org-1', placedByCustomerAccountId: 'member-b' });
  });

  it('answers 404 ORDER_NOT_FOUND for an order outside that scope, and creates nothing', async () => {
    const { service, createForCustomer } = rig('regular_user', null);
    await expect(service.clone('order-1', CTX)).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.ORDER_NOT_FOUND,
    });
    expect(createForCustomer).not.toHaveBeenCalled();
  });

  it('lets an organization admin reach any order of the Organization', async () => {
    const { service, wheres } = rig('organization_admin');
    await service.clone('order-1', CTX);
    expect(wheres[0]).toEqual({ id: 'order-1' });
  });

  it('never tells the quote module the caller is an organization admin', async () => {
    const { service, createForCustomer } = rig('organization_admin');
    await service.clone('order-1', CTX);
    expect(createForCustomer.mock.calls[0]?.[0]).toEqual({
      customerAccountId: 'member-b',
      organizationId: 'org-1',
      isOrgAdmin: false,
    });
  });
});

describe('#665 — OrderReorderService resolves the order through the read scope', () => {
  function rig(role: 'regular_user' | 'organization_admin', order: unknown) {
    const replaceItemsForCustomer = vi.fn(async () => ({ cart: { id: 'cart-1' }, items: [], unorderable: [] }));
    const { em, wheres } = emRecording(order);
    const service = new OrderReorderService(
      em,
      { replaceItemsForCustomer } as unknown as CartWritePort,
      { findByIds: async () => [{ id: 'prod-1', archivedAt: null }] } as unknown as CatalogProductReadPort,
      accounts(role),
    );
    return { service, replaceItemsForCustomer, wheres };
  }
  const ORDER = { id: 'order-1', organizationId: 'org-1', salesChannelId: 'ch-1', currency: 'PLN' };
  const REORDER_CTX = { ...CTX, salesChannelId: 'ch-1' };

  it('pins a regular member to the orders they placed', async () => {
    const { service, wheres } = rig('regular_user', ORDER);
    await service.reorder('order-1', REORDER_CTX);
    expect(wheres[0]).toEqual({ id: 'order-1', organizationId: 'org-1', placedByCustomerAccountId: 'member-b' });
  });

  it('answers 404 ORDER_NOT_FOUND for an order outside that scope, and seeds no cart', async () => {
    const { service, replaceItemsForCustomer } = rig('regular_user', null);
    await expect(service.reorder('order-1', REORDER_CTX)).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.ORDER_NOT_FOUND,
    });
    expect(replaceItemsForCustomer).not.toHaveBeenCalled();
  });

  it('lets an organization admin reach any order of the Organization', async () => {
    const { service, wheres } = rig('organization_admin', ORDER);
    await service.reorder('order-1', REORDER_CTX);
    expect(wheres[0]).toEqual({ id: 'order-1' });
  });
});
