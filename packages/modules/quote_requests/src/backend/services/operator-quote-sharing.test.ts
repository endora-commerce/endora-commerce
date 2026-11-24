import { describe, expect, it, vi } from 'vitest';
import type { CustomerAccountRecord } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import {
  applyShare,
  customerUnavailability,
  normaliseShareValidityDays,
  operatorQuoteStartsUnshared,
  unpricedLinesRefusal,
} from './operator-quote-sharing.js';

/**
 * `specs/192-quote-request-draft-share/` T022 — the rules a share applies, in
 * one module: where a new operator quote starts (R-2), the validity days
 * (R-10), the refusals (R-8, R-9) and what a share writes (R-4, R-5).
 */

describe('operatorQuoteStartsUnshared (research R-2)', () => {
  it('a new operator quote starts unshared — always, until a setting says otherwise', () => {
    expect(operatorQuoteStartsUnshared()).toBe(true);
  });
});

describe('normaliseShareValidityDays (research R-10, FR-032)', () => {
  it('0 and null are no deadline; a positive number is kept', () => {
    expect(normaliseShareValidityDays(null)).toBeNull();
    expect(normaliseShareValidityDays(0)).toBeNull();
    expect(normaliseShareValidityDays(30)).toBe(30);
  });
});

describe('unpricedLinesRefusal (research R-8, FR-026)', () => {
  const G1 = '00000000-0000-4000-8000-000000000101';
  const line = (id: string, price: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    productName: `Product ${id}`,
    variantLabel: null,
    agreedUnitPrice: price,
    groupId: null,
    position: 0,
    ...extra,
  });

  it('answers nothing when every line has a price — zero included', () => {
    expect(unpricedLinesRefusal({ lines: [line('a', '1.0000'), line('b', '0.0000')], groups: [] })).toBeNull();
  });

  it('names every unpriced line, in display order, with its group', () => {
    const refusal = unpricedLinesRefusal({
      groups: [{ id: G1, name: 'Hall A' }],
      lines: [
        line('a', null, { groupId: G1, position: 0 }),
        line('b', '5.0000', { groupId: G1, position: 1 }),
        line('c', null, { position: 0, variantLabel: 'Red' }),
      ],
    });
    expect(refusal).toBeInstanceOf(HttpError);
    expect(refusal).toMatchObject({
      statusCode: 409,
      code: 'QUOTE_INCOMPLETE',
      details: {
        code: 'share',
        lines: [
          { id: 'a', position: 0, productName: 'Product a', variantLabel: null, groupName: 'Hall A' },
          { id: 'c', position: 0, productName: 'Product c', variantLabel: 'Red', groupName: null },
        ],
      },
    });
  });
});

describe('customerUnavailability (research R-9, FR-027)', () => {
  const ORG = '00000000-0000-4000-8000-000000000001';
  const account = (overrides: Partial<CustomerAccountRecord> = {}) =>
    ({ id: 'c', organizationId: ORG, deletedAt: null, anonymizedAt: null, blockedAt: null, ...overrides }) as CustomerAccountRecord;

  it('an active member of the quote’s Organization is available', () => {
    expect(customerUnavailability(account(), ORG)).toBeNull();
  });

  it('gone, or in another Organization → not_member', () => {
    expect(customerUnavailability(null, ORG)).toBe('not_member');
    expect(customerUnavailability(account({ organizationId: '00000000-0000-4000-8000-000000000002' }), ORG)).toBe('not_member');
  });

  it('deleted or anonymised → inactive; blocked → blocked', () => {
    expect(customerUnavailability(account({ deletedAt: new Date() }), ORG)).toBe('inactive');
    expect(customerUnavailability(account({ anonymizedAt: new Date() }), ORG)).toBe('inactive');
    expect(customerUnavailability(account({ blockedAt: new Date() }), ORG)).toBe('blocked');
  });
});

describe('applyShare (research R-4, R-5, R-10)', () => {
  const NOW = new Date('2026-11-24T12:00:00.000Z');
  const ADMIN = '00000000-0000-4000-8000-0000000000b1';

  function rig(days: number | null) {
    const quote = Object.assign(new QuoteRequest(), {
      organizationId: '00000000-0000-4000-8000-000000000001',
      customerAccountId: '00000000-0000-4000-8000-000000000002',
      status: 'Created from admin' as const,
      sharedWithCustomer: false,
      shareValidityDays: days,
      currentRevisionNumber: 2,
      version: 4,
    });
    const event = { id: 'evt', eventType: 'shared', payload: {}, createdAt: NOW };
    const em = { flush: vi.fn(async () => undefined) };
    const deps = {
      eventService: { append: vi.fn(async (_input: unknown, _em: unknown) => event) },
      notificationService: { record: vi.fn(async () => 3) },
      revisionService: { byNumber: vi.fn(async () => ({ id: 'rev-2' })) },
    };
    return { quote, event, em, deps };
  }

  it('writes the share, the date from the stored days, the `shared` entry and the `prepared` records', async () => {
    const { quote, event, em, deps } = rig(30);
    const written = await applyShare(em as never, quote, { adminUserId: ADMIN, roleLabel: 'Sales representative' }, NOW, deps as never);

    expect(quote).toMatchObject({
      sharedWithCustomer: true,
      sharedAt: NOW,
      sharedByAdminUserId: ADMIN,
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
      version: 5,
    });
    expect(deps.eventService.append).toHaveBeenCalledWith(
      {
        quoteRequestId: quote.id,
        eventType: 'shared',
        actor: { adminUserId: ADMIN, roleLabel: 'Sales representative' },
        payload: { type: 'shared', validityDays: 30, expiresAt: '2026-12-24T12:00:00.000Z' },
        revisionId: 'rev-2',
      },
      em,
    );
    expect(deps.notificationService.record).toHaveBeenCalledWith(em, {
      change: 'prepared',
      sourceEvent: event,
      rfq: quote,
      actor: null,
    });
    expect(written).toBe(event);
  });

  it('no days: no date', async () => {
    const { quote, em, deps } = rig(null);
    await applyShare(em as never, quote, { adminUserId: ADMIN, roleLabel: null }, NOW, deps as never);
    expect(quote.expiresAt).toBeNull();
    expect(deps.eventService.append.mock.calls[0]![0]).toMatchObject({
      payload: { type: 'shared', validityDays: null, expiresAt: null },
    });
  });
});
