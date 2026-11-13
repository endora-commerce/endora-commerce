import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';

/** The channel the admin request resolved, as the kernel's request scope answers it. */
const channelState: { current: { id: string } | null } = { current: null };
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/platform/kernel')>()),
  currentSalesChannel: () => channelState.current,
}));

const { RfqAdminService } = await import('./rfq-admin-service.js');

/**
 * Feature 163 (FR-018, T155 finding §1.5c) — an operator creating a quote
 * request on a customer's behalf names the channel it is raised on. That
 * channel is the one stored on the request and the one its availability
 * warnings speak about; without it the request landed on whatever the admin's
 * own request resolved (the system default), and a B2C customer's line switched
 * off in B2C was never named. An unknown channel is refused before anything is
 * numbered or written.
 *
 * Owner decision 2026-10-29 "A" — the server is the sole enforcer: the channel
 * the request lands on, named or not, must be one of the Organization's active
 * channels. With no `salesChannelId` the request falls back to the channel the
 * admin request resolved (the system default, or `X-Sales-Channel`), and that
 * fallback is checked exactly as a named one is; with no channel at all (no
 * request scope) there is nothing to raise the request on, and it is refused.
 *
 * Service-free: the resolved channel is the mocked request-scope slot above.
 */

const ORG_ID = '00000000-0000-4000-8000-0000000000b1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const B2C = '00000000-0000-4000-8000-0000000000d1';
const ADMIN = { adminUserId: 'admin-1', isPlatformAdmin: true, roleLabel: 'Platform administrator' };

/**
 * The create, as a platform administrator's request runs it: under a
 * platform-wide tenant scope, which is what lets it past the organization
 * visibility check (issue #957 — the scope decides, not `isPlatformAdmin`).
 */
const createAsPlatformAdmin = (svc: InstanceType<typeof RfqAdminService>, b: never) =>
  withSystemScope('test: a platform-wide administrator', () => svc.createOnBehalf(ADMIN, b));

const record = {
  id: PRODUCT_ID,
  sku: 'SKU-1',
  slug: 'p-1',
  type: 'simple',
  status: 'active',
  name: { 'pl-PL': 'Produkt' },
  visibility: 'public',
  allowedOrganizationIds: [],
  archivedAt: null,
  deletedAt: null,
};

const body = (extra: Record<string, unknown> = {}) =>
  ({
    organizationId: ORG_ID,
    customerAccountId: CUSTOMER_ID,
    items: [{ productId: PRODUCT_ID, quantity: 1, agreedUnitPrice: 1 }],
    ...extra,
  }) as never;

const OTHER = '00000000-0000-4000-8000-0000000000d2';
const INACTIVE = '00000000-0000-4000-8000-0000000000d3';
/** The Organization's channels, as the kernel membership port answers them. */
const ORG_CHANNELS = [
  { id: B2C, active: true },
  { id: INACTIVE, active: false },
];

function service(em: Record<string, unknown>, filterAvailable = vi.fn(async () => new Set<string>())) {
  const generateBusinessId = vi.fn(async () => null);
  const listChannelsForEntity = vi.fn(async () => ORG_CHANNELS);
  const svc = new RfqAdminService({
    channelMembership: { listChannelsForEntity },
    emFactory: () => em,
    customerAccounts: { findById: async () => ({ id: CUSTOMER_ID, organizationId: ORG_ID }) },
    catalogProducts: { findByIds: async () => [record] },
    catalogAvailability: { filterAvailable },
    rfqService: { generateBusinessId },
  } as never);
  return { svc, generateBusinessId, filterAvailable, listChannelsForEntity };
}


/** `begin` / `commit` / `rollback` of an EntityManager double: the write never reaches the database. */
function transactionStubs() {
  return { begin: vi.fn(async () => undefined), commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined) };
}

describe('163 — the channel an operator raises a quote request on', () => {
  beforeEach(() => {
    channelState.current = null;
  });

  it('warns about the lines unavailable at the channel the body names', async () => {
    const { svc, filterAvailable } = service({});
    const warnings = await svc.onBehalfWarnings(body({ salesChannelId: B2C }));
    expect(filterAvailable).toHaveBeenCalledWith([PRODUCT_ID], expect.objectContaining({ channelId: B2C, languageCode: null }));
    expect(warnings).toEqual([{ productId: PRODUCT_ID, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]);
  });

  it('warns about the lines unavailable at the resolved channel when the body names none', async () => {
    channelState.current = { id: B2C };
    const { svc, filterAvailable } = service({});
    await svc.onBehalfWarnings(body());
    expect(filterAvailable).toHaveBeenCalledWith([PRODUCT_ID], expect.objectContaining({ channelId: B2C }));
  });

  it('stores the request on the channel the body names', async () => {
    const create = vi.fn((_entity: unknown, data: Record<string, unknown>) => data);
    const em = {
      findOne: vi.fn(async () => ({ id: B2C })),
      create,
      persistAndFlush: vi.fn(async () => {
        throw new Error('reached the write');
      }),
      // The write runs in a transaction of its own (`specs/179-…` WP-04).
      ...transactionStubs(),
    };
    const { svc } = service(em);
    await expect(createAsPlatformAdmin(svc, body({ salesChannelId: B2C }))).rejects.toThrow('reached the write');
    expect(create.mock.calls[0]?.[1]).toMatchObject({ salesChannelId: B2C });
  });

  it.each([
    ['unknown, or not one of the Organization’s channels', OTHER],
    ['one of the Organization’s channels, but inactive', INACTIVE],
  ])('refuses a channel that is %s, before anything is numbered or created (security M1)', async (_what, channelId) => {
    const create = vi.fn();
    const { svc, generateBusinessId, listChannelsForEntity } = service({ create });
    const caught = (await createAsPlatformAdmin(svc, body({ salesChannelId: channelId })).then(
      () => null,
      (error: unknown) => error,
    )) as { statusCode?: number; code?: string } | null;
    expect(caught).toMatchObject({ statusCode: 422, code: ERROR_CODES.RFQ_SALES_CHANNEL_NOT_ALLOWED });
    expect(listChannelsForEntity).toHaveBeenCalledWith('organization', ORG_ID);
    expect(generateBusinessId).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  /** The refusal `createOnBehalf` answers, or `null` when it reached the write. */
  async function outcomeOf(svc: InstanceType<typeof RfqAdminService>, b: never) {
    return (await createAsPlatformAdmin(svc, b).then(
      () => null,
      (error: unknown) => error,
    )) as { statusCode?: number; code?: string; message?: string; details?: unknown } | null;
  }

  it.each([
    ['the system default, not one of the Organization’s channels', OTHER],
    ['one of the Organization’s channels, but inactive', INACTIVE],
  ])(
    'refuses an omitted channel whose resolved fallback is %s (owner decision 2026-10-29 A)',
    async (_what, resolved) => {
      channelState.current = { id: resolved };
      const create = vi.fn();
      const { svc, generateBusinessId, listChannelsForEntity } = service({ create });
      const caught = await outcomeOf(svc, body());
      expect(caught).toMatchObject({ statusCode: 422, code: ERROR_CODES.RFQ_SALES_CHANNEL_NOT_ALLOWED });
      expect(listChannelsForEntity).toHaveBeenCalledWith('organization', ORG_ID);
      expect(generateBusinessId).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('stores an omitted channel’s resolved fallback when it is one of the Organization’s active channels', async () => {
    channelState.current = { id: B2C };
    const create = vi.fn((_entity: unknown, data: Record<string, unknown>) => data);
    const em = {
      create,
      persistAndFlush: vi.fn(async () => {
        throw new Error('reached the write');
      }),
      // The write runs in a transaction of its own (`specs/179-…` WP-04).
      ...transactionStubs(),
    };
    const { svc, listChannelsForEntity } = service(em);
    await expect(createAsPlatformAdmin(svc, body())).rejects.toThrow('reached the write');
    expect(listChannelsForEntity).toHaveBeenCalledWith('organization', ORG_ID);
    expect(create.mock.calls[0]?.[1]).toMatchObject({ salesChannelId: B2C });
  });

  it('refuses a request with no channel at all — none named and none resolved (Constitution XII)', async () => {
    const create = vi.fn();
    const { svc, generateBusinessId, listChannelsForEntity } = service({ create });
    const caught = await outcomeOf(svc, body());
    // Same code, its own sentence: there is no channel to call foreign.
    expect(caught).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.RFQ_SALES_CHANNEL_NOT_ALLOWED,
      message: 'No sales channel to raise this quote request on: name salesChannelId.',
      details: { code: 'no_channel' },
    });
    expect(listChannelsForEntity).not.toHaveBeenCalled();
    expect(generateBusinessId).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('checks the named channel, not the resolved one, when the body names one', async () => {
    channelState.current = { id: OTHER };
    const create = vi.fn((_entity: unknown, data: Record<string, unknown>) => data);
    const em = {
      create,
      persistAndFlush: vi.fn(async () => {
        throw new Error('reached the write');
      }),
      // The write runs in a transaction of its own (`specs/179-…` WP-04).
      ...transactionStubs(),
    };
    const { svc } = service(em);
    await expect(createAsPlatformAdmin(svc, body({ salesChannelId: B2C }))).rejects.toThrow('reached the write');
    expect(create.mock.calls[0]?.[1]).toMatchObject({ salesChannelId: B2C });
  });
});
