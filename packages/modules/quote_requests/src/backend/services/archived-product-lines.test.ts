import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { RfqAdminService } from './rfq-admin-service.js';
import { RfqService } from './rfq-service.js';

/**
 * Feature 163, owner decision P-3 = A (2026-10-26) — a quote request refuses a
 * line whose product is archived, on every path that names products: the
 * buyer's create (and so cart conversion, quick order, shopping lists and order
 * clone, which all come through it), and the operator's create on a customer's
 * behalf. On the buyer's paths the refusal is the one each already gives an
 * unknown product — the whole request answers `404 PRODUCT_NOT_FOUND` before
 * anything is written, so nothing about the product is disclosed. The operator
 * is told why (owner decision P-3b = A): `409 PRODUCT_ARCHIVED`, catalog's code,
 * still before anything is written; an id that does not exist stays a 404.
 *
 * Fast and service-free: the services are built over the few collaborators the
 * refusal reaches, and every collaborator past it is a spy that must not run.
 * The route-level cases (draft edit, resubmit, admin modify, convert) are
 * `[PG]` in `backend/test/integration/quote_requests/archived-product.test.ts`.
 */

const ARCHIVED_ID = '00000000-0000-4000-8000-0000000000a1';
const LIVE_ID = '00000000-0000-4000-8000-0000000000a2';
const ORG_ID = '00000000-0000-4000-8000-0000000000b1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
/**
 * The channel the operator's requests below are raised on, one of the
 * Organization's active channels: outside a request scope there is no resolved
 * channel, and `createOnBehalf` refuses a request with none (owner decision
 * 2026-10-29 "A") before it reaches the products.
 */
const CHANNEL_ID = '00000000-0000-4000-8000-0000000000d1';
const channelMembership = { listChannelsForEntity: async () => [{ id: CHANNEL_ID, active: true }] };

function record(id: string, archivedAt: Date | null) {
  return {
    id,
    sku: `SKU-${id.slice(-2)}`,
    slug: `p-${id.slice(-2)}`,
    type: 'simple',
    status: 'active',
    name: { en: `Product ${id.slice(-2)}` },
    visibility: 'public',
    allowedOrganizationIds: [],
    archivedAt,
    deletedAt: null,
  };
}

const findByIds = vi.fn(async (ids: readonly string[]) =>
  ids.map((id) => record(id, id === ARCHIVED_ID ? new Date('2026-10-01T00:00:00Z') : null)),
);

async function refusalOf(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
  const caught = (await promise.then(
    () => null,
    (error: unknown) => error,
  )) as { statusCode?: number; code?: string } | null;
  expect(caught, 'the write must be refused').not.toBeNull();
  return { statusCode: caught!.statusCode ?? 0, code: caught!.code ?? '' };
}

describe('163 P-3 — a quote request refuses an archived product', () => {
  it('the operator’s create on a customer’s behalf answers 409 PRODUCT_ARCHIVED before anything is created', async () => {
    const create = vi.fn();
    const generateBusinessId = vi.fn();
    const service = new RfqAdminService({
      channelMembership,
      emFactory: () => ({ create, persistAndFlush: vi.fn() }),
      customerAccounts: { findById: async () => ({ id: CUSTOMER_ID, organizationId: ORG_ID }) },
      catalogProducts: { findByIds },
      rfqService: { generateBusinessId },
    } as never);

    const refusal = await refusalOf(
      service.createOnBehalf(
        { adminUserId: 'admin-1', isPlatformAdmin: true, roleLabel: 'Platform administrator' },
        {
          organizationId: ORG_ID,
          customerAccountId: CUSTOMER_ID,
          salesChannelId: CHANNEL_ID,
          items: [
            { productId: LIVE_ID, quantity: 1 },
            { productId: ARCHIVED_ID, quantity: 1 },
          ],
        } as never,
      ),
    );
    expect(refusal).toEqual({ statusCode: 409, code: ERROR_CODES.PRODUCT_ARCHIVED });
    expect(generateBusinessId).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('the operator’s create still answers 404 PRODUCT_NOT_FOUND for an id that does not exist', async () => {
    const generateBusinessId = vi.fn();
    const service = new RfqAdminService({
      channelMembership,
      emFactory: () => ({}),
      customerAccounts: { findById: async () => ({ id: CUSTOMER_ID, organizationId: ORG_ID }) },
      catalogProducts: { findByIds: async () => [] },
      rfqService: { generateBusinessId },
    } as never);
    const refusal = await refusalOf(
      service.createOnBehalf(
        { adminUserId: 'admin-1', isPlatformAdmin: true, roleLabel: 'Platform administrator' },
        { organizationId: ORG_ID, customerAccountId: CUSTOMER_ID, salesChannelId: CHANNEL_ID, items: [{ productId: ARCHIVED_ID, quantity: 1 }] } as never,
      ),
    );
    expect(refusal).toEqual({ statusCode: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND });
    expect(generateBusinessId).not.toHaveBeenCalled();
  });

  it('the operator’s create still accepts a request whose products are all live', async () => {
    // The positive control: without it the case above would pass on a service
    // that refused everything.
    const generateBusinessId = vi.fn(async () => {
      throw new Error('reached the write');
    });
    const service = new RfqAdminService({
      channelMembership,
      emFactory: () => ({}),
      customerAccounts: { findById: async () => ({ id: CUSTOMER_ID, organizationId: ORG_ID }) },
      catalogProducts: { findByIds },
      rfqService: { generateBusinessId },
    } as never);
    await expect(
      service.createOnBehalf(
        { adminUserId: 'admin-1', isPlatformAdmin: true, roleLabel: 'Platform administrator' },
        { organizationId: ORG_ID, customerAccountId: CUSTOMER_ID, salesChannelId: CHANNEL_ID, items: [{ productId: LIVE_ID, quantity: 1 }] } as never,
      ),
    ).rejects.toThrow('reached the write');
  });

  it('a buyer’s create outside a request scope (no channel) refuses it too, as an unknown product', async () => {
    // With a channel, `filterAvailable` already excludes an archived product.
    // Without one — a worker, a CLI script, an in-process caller with no
    // request — only the audience rule used to run, and an archived product
    // passed it.
    const filterAvailable = vi.fn();
    const service = new RfqService({
      emFactory: () => ({}),
      negotiationPolicy: { assertProposalsAllowed: async () => undefined },
      catalogProducts: { findByIds },
      catalogAvailability: { filterAvailable },
    } as never);

    const ctx = { customerAccountId: CUSTOMER_ID, organizationId: ORG_ID };
    const refused = await refusalOf(
      service.createForCustomer(ctx, { items: [{ productId: ARCHIVED_ID, quantity: 1 }] } as never),
    );
    expect(refused).toEqual({ statusCode: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND });
    expect(filterAvailable).not.toHaveBeenCalled();
  });
});
