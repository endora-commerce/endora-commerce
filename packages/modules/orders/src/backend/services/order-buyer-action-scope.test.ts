import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type {
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  OrganizationPermissionPort,
  OrganizationPermissionSubject,
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
 * `{ id, organizationId }`. The scope belongs to the service, so no caller can
 * reach a colleague's order by forgetting a route-level check.
 *
 * `specs/170-organization-roles/` (FR-049, OR-5; WP-07) — the rule is the
 * permission `orders.view_organization`, asked of `organizationPermissionPort`
 * for the buyer: a member without it is pinned to the orders they placed, a
 * holder (the *Administrator* holds it implicitly) is not. The legacy role is
 * no longer read.
 */

const CTX = { customerAccountId: 'member-b', organizationId: 'org-1' };

type Holding = 'without' | 'with';

/** The permission port as the scope asks it, recording every question. */
function permissions(holding: Holding) {
  const asked: Array<[OrganizationPermissionSubject, string]> = [];
  const port = {
    can: async (subject: OrganizationPermissionSubject, code: string) => {
      asked.push([subject, code]);
      return holding === 'with' && code === 'orders.view_organization';
    },
  } as unknown as OrganizationPermissionPort;
  return { port, asked };
}

/** An account read that would grant everything if the scope still asked the legacy role. */
const LEGACY_ADMIN_ACCOUNTS = {
  findById: async (id: string) => ({ id, role: 'organization_admin', organizationId: 'org-1' }),
} as unknown as CustomerAccountReadPort;

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
  function rig(holding: Holding, order: unknown = { id: 'order-1' }) {
    const createForCustomer = vi.fn(async (_ctx: unknown, _request: unknown, _options: unknown) => ({ id: 'rfq-1' }));
    const { em, wheres } = emRecording(order);
    const { port, asked } = permissions(holding);
    const service = new OrderCloneToQuoteService(
      em,
      () => ({ createForCustomer }) as unknown as RfqCustomerPort,
      port,
    );
    return { service, createForCustomer, wheres, asked };
  }

  it('pins a member without orders.view_organization to the orders they placed', async () => {
    const { service, wheres } = rig('without');
    await service.clone('order-1', CTX);
    expect(wheres[0]).toEqual({ id: 'order-1', organizationId: 'org-1', placedByCustomerAccountId: 'member-b' });
  });

  it('asks the permission port for orders.view_organization, for the buyer', async () => {
    const { service, asked } = rig('without');
    await service.clone('order-1', CTX);
    expect(asked).toEqual([[{ customerAccountId: 'member-b', organizationId: 'org-1' }, 'orders.view_organization']]);
  });

  it('answers 404 ORDER_NOT_FOUND for an order outside that scope, and creates nothing', async () => {
    const { service, createForCustomer } = rig('without', null);
    await expect(service.clone('order-1', CTX)).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.ORDER_NOT_FOUND,
    });
    expect(createForCustomer).not.toHaveBeenCalled();
  });

  it('lets a holder of orders.view_organization reach any order of the Organization', async () => {
    const { service, wheres } = rig('with');
    await service.clone('order-1', CTX);
    expect(wheres[0]).toEqual({ id: 'order-1' });
  });

  it('never tells the quote module the caller is an organization admin', async () => {
    const { service, createForCustomer } = rig('with');
    await service.clone('order-1', CTX);
    expect(createForCustomer.mock.calls[0]?.[0]).toEqual({
      customerAccountId: 'member-b',
      organizationId: 'org-1',
    });
  });
});

describe('#665 — OrderReorderService resolves the order through the read scope', () => {
  function rig(holding: Holding, order: unknown) {
    const replaceItemsForCustomer = vi.fn(async () => ({ cart: { id: 'cart-1' }, items: [], unorderable: [] }));
    const { em, wheres } = emRecording(order);
    const service = new OrderReorderService(
      em,
      { replaceItemsForCustomer } as unknown as CartWritePort,
      { findByIds: async () => [{ id: 'prod-1', archivedAt: null }] } as unknown as CatalogProductReadPort,
      LEGACY_ADMIN_ACCOUNTS,
      permissions(holding).port,
    );
    return { service, replaceItemsForCustomer, wheres };
  }
  const ORDER = { id: 'order-1', organizationId: 'org-1', salesChannelId: 'ch-1', currency: 'PLN' };
  const REORDER_CTX = { ...CTX, salesChannelId: 'ch-1' };

  it('pins a member without orders.view_organization to the orders they placed, whatever the legacy role', async () => {
    const { service, wheres } = rig('without', ORDER);
    await service.reorder('order-1', REORDER_CTX);
    expect(wheres[0]).toEqual({ id: 'order-1', organizationId: 'org-1', placedByCustomerAccountId: 'member-b' });
  });

  it('answers 404 ORDER_NOT_FOUND for an order outside that scope, and seeds no cart', async () => {
    const { service, replaceItemsForCustomer } = rig('without', null);
    await expect(service.reorder('order-1', REORDER_CTX)).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.ORDER_NOT_FOUND,
    });
    expect(replaceItemsForCustomer).not.toHaveBeenCalled();
  });

  it('lets a holder of orders.view_organization reach any order of the Organization', async () => {
    const { service, wheres } = rig('with', ORDER);
    await service.reorder('order-1', REORDER_CTX);
    expect(wheres[0]).toEqual({ id: 'order-1' });
  });
});
