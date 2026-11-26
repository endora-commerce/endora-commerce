import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { QUOTE_VALIDITY_DAYS_MAX } from '@endora-commerce/contracts';
import type { CustomerAccountRecord } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import {
  applyShare,
  customerUnavailability,
  defaultValidityDaysFromSetting,
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

describe('defaultValidityDaysFromSetting (research R-12)', () => {
  it('keeps a whole number of days from 0 to the bound', () => {
    expect(defaultValidityDaysFromSetting(0)).toBe(0);
    expect(defaultValidityDaysFromSetting(30)).toBe(30);
    expect(defaultValidityDaysFromSetting(QUOTE_VALIDITY_DAYS_MAX)).toBe(3650);
  });

  it('answers null — read as 0, no deadline — for anything else', () => {
    for (const stored of [3651, 1e9, -1, 1.5, Number.NaN, '30', null, undefined]) {
      expect(defaultValidityDaysFromSetting(stored), String(stored)).toBeNull();
    }
  });
});

/**
 * `specs/192-quote-request-draft-share/` (FR-001, research R-2) — the only
 * code that makes a quote invisible to its customer is the operator's create,
 * `RfqAdminService.createOnBehalf`. Any other writer of `sharedWithCustomer`
 * that is not `true` would hide a quote the customer already has, so a new one
 * fails here and must be reviewed.
 */
describe('the only writer of sharedWithCustomer = false', () => {
  const backend = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
    });

  it('is the create-on-behalf Command (the share Command’s audit `before` is a record, not a write)', () => {
    const found: string[] = [];
    for (const file of sources(backend)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const sql = /shared_with_customer"?\s*=\s*false/i.test(line);
        const write = /sharedWithCustomer\s*(?::|=(?!=))(?!\s*(?:true|boolean|(?:rfq|quote)\.sharedWithCustomer)\b)/.test(line);
        if (!sql && !write) return;
        const method = lines
          .slice(0, index)
          .reverse()
          .map((above) => /^ {2}(?:async |private |public |static )*#?(\w+)\(/.exec(above)?.[1] ?? /^(?:export )?(?:async )?function (\w+)/.exec(above)?.[1])
          .find(Boolean);
        found.push(`${relative(backend, file)} ${method ?? '?'}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([
      'commands/quote-request-admin-commands.ts makeCreateOnBehalfCommand: sharedWithCustomer: !startsUnshared,',
      'commands/share-command.ts makeShareQuoteRequestCommand: sharedWithCustomer: false,',
    ]);
  });
});
