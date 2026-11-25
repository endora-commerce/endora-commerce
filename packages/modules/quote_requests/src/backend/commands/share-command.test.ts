import { describe, expect, it, vi } from 'vitest';
import { QUOTE_REQUEST_HOOKABLE_ACTIONS } from '@endora-commerce/contracts';
import { expectHookableCommand } from '@endora-commerce/test-kit/command-hooks';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { makeShareQuoteRequestCommand } from './share-command.js';

/**
 * `specs/192-quote-request-draft-share/` T023 — the share Command
 * (`contracts/admin-api.md` §1): its identity is the hookable action's, its
 * refusals come in the contract's order and write nothing, and a share
 * answers the hook data and list-1 audit state of `data-model.md` §5.
 */
const ORG = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
const ADMIN = '00000000-0000-4000-8000-0000000000b1';
const QUOTE = '00000000-0000-4000-8000-000000000003';
const NOW = new Date('2026-11-24T12:00:00.000Z');

function rig(
  options: {
    quote?: Partial<QuoteRequest> | null;
    canSee?: boolean;
    lines?: Array<{ agreedUnitPrice: string | null }>;
    account?: Record<string, unknown> | null;
    expectedVersion?: number | null;
  } = {},
) {
  const quote =
    options.quote === null
      ? null
      : Object.assign(new QuoteRequest(), {
          id: QUOTE,
          organizationId: ORG,
          customerAccountId: CUSTOMER,
          salesChannelId: null,
          status: 'Created from admin',
          sharedWithCustomer: false,
          shareValidityDays: 14,
          currentRevisionNumber: 1,
          version: 3,
          ...(options.quote ?? {}),
        });
  const lines = (options.lines ?? [{ agreedUnitPrice: '5.0000' }]).map((line, index) => ({
    id: `line-${index}`,
    productName: `Product ${index}`,
    variantLabel: null,
    groupId: null,
    position: index,
    createdAt: NOW,
    ...line,
  }));
  const em = {
    findOne: vi.fn(async () => quote),
    find: vi.fn(async (entity: { name?: string }) => (String(entity?.name ?? '').includes('Group') ? [] : lines)),
    flush: vi.fn(async () => undefined),
  };
  const sharedEvent = { id: 'evt', eventType: 'shared', payload: {}, createdAt: NOW };
  const deps = {
    salesRepScope: { canSeeOrganization: vi.fn(async () => options.canSee ?? true) },
    isPlatformAdmin: () => false,
    customerAccounts: {
      findById: vi.fn(async () =>
        options.account === null
          ? null
          : { id: CUSTOMER, organizationId: ORG, deletedAt: null, anonymizedAt: null, blockedAt: null, ...(options.account ?? {}) },
      ),
    },
    eventService: { append: vi.fn(async () => sharedEvent) },
    notificationService: { record: vi.fn(async () => 3) },
    revisionService: { byNumber: vi.fn(async () => ({ id: 'rev-1' })) },
    now: () => NOW,
  };
  const command = makeShareQuoteRequestCommand(
    { quoteRequestId: QUOTE, expectedVersion: options.expectedVersion ?? null, roleLabel: 'Sales representative' },
    deps as never,
  );
  const ctx = { em, actor: { kind: 'admin', actorAdminUserId: ADMIN, impersonatedCustomerAccountId: null } } as never;
  return { quote, em, deps, command, ctx };
}

async function refusal(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error('expected a refusal');
}

describe('quote_request.share (contracts/admin-api.md §1)', () => {
  it('is the hookable action, on the quote, and supplies its hook data (contracts/share-hook.md §5)', () => {
    const { command, quote } = rig();
    expectHookableCommand(command, QUOTE_REQUEST_HOOKABLE_ACTIONS.share, { result: { quote: quote! } });
    expect(command).toMatchObject({
      action: QUOTE_REQUEST_HOOKABLE_ACTIONS.share.action,
      objectType: QUOTE_REQUEST_HOOKABLE_ACTIONS.share.objectType,
      objectId: QUOTE,
    });
  });

  it('reads the row for update, shares it and answers the hook data and list-1 audit state', async () => {
    const { command, ctx, em, deps, quote } = rig();
    const outcome = await command.run(ctx);
    expect(em.findOne).toHaveBeenCalledWith(QuoteRequest, { id: QUOTE }, expect.objectContaining({ lockMode: expect.anything() }));
    const expiresAt = '2026-12-08T12:00:00.000Z';
    expect(outcome.before).toEqual({ sharedWithCustomer: false, expiresAt: null, version: 3 });
    expect(outcome.after).toEqual({ sharedWithCustomer: true, expiresAt, version: 4 });
    expect(quote).toMatchObject({ sharedWithCustomer: true, sharedByAdminUserId: ADMIN });
    expect(deps.notificationService.record).toHaveBeenCalledTimes(1);
    expect(command.hookData!(outcome.result)).toEqual({
      quoteRequestId: QUOTE,
      organizationId: ORG,
      customerAccountId: CUSTOMER,
      salesChannelId: null,
      currentRevisionNumber: 1,
      expiresAt,
    });
  });

  it('records the validity date the draft carried before the share in the audit `before`', async () => {
    const stale = new Date('2026-11-01T00:00:00.000Z');
    const { command, ctx } = rig({ quote: { expiresAt: stale } });
    const outcome = await command.run(ctx);
    expect(outcome.before).toEqual({ sharedWithCustomer: false, expiresAt: stale.toISOString(), version: 3 });
    expect(outcome.after).toEqual({ sharedWithCustomer: true, expiresAt: '2026-12-08T12:00:00.000Z', version: 4 });
  });

  it.each([
    ['an unknown quote', { quote: null }, 404, 'NOT_FOUND'],
    ['a quote the caller may not see', { canSee: false }, 404, 'NOT_FOUND'],
    ['an already shared quote', { quote: { sharedWithCustomer: true } }, 409, 'RFQ_ALREADY_SHARED'],
    ['a cancelled draft', { quote: { status: 'Canceled' } }, 409, 'RFQ_NOT_QUOTED'],
    ['a stale version', { expectedVersion: 2 }, 409, 'VERSION_CONFLICT'],
    ['an unpriced line', { lines: [{ agreedUnitPrice: null }] }, 409, 'QUOTE_INCOMPLETE'],
    ['a blocked customer', { account: { blockedAt: NOW } }, 409, 'RFQ_SHARE_CUSTOMER_UNAVAILABLE'],
  ] as const)('refuses %s and writes nothing', async (_name, options, statusCode, code) => {
    const { command, ctx, em, deps } = rig(options as never);
    expect(await refusal(command.run(ctx))).toMatchObject({ statusCode, code });
    expect(em.flush).not.toHaveBeenCalled();
    expect(deps.eventService.append).not.toHaveBeenCalled();
    expect(deps.notificationService.record).not.toHaveBeenCalled();
  });

  it('answers the first refusal of several, in the contract’s order', async () => {
    const shared = rig({ quote: { sharedWithCustomer: true, status: 'Canceled' }, expectedVersion: 1 });
    expect(await refusal(shared.command.run(shared.ctx))).toMatchObject({ code: 'RFQ_ALREADY_SHARED' });
    const stale = rig({ quote: { status: 'Canceled' }, expectedVersion: 1 });
    expect(await refusal(stale.command.run(stale.ctx))).toMatchObject({ code: 'RFQ_NOT_QUOTED' });
    const unpriced = rig({ expectedVersion: 1, lines: [{ agreedUnitPrice: null }] });
    expect(await refusal(unpriced.command.run(unpriced.ctx))).toMatchObject({ code: 'VERSION_CONFLICT' });
    const both = rig({ lines: [{ agreedUnitPrice: null }], account: null });
    expect(await refusal(both.command.run(both.ctx))).toMatchObject({ code: 'QUOTE_INCOMPLETE' });
  });
});
