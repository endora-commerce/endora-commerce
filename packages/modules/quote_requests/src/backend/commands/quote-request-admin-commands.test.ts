import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { QUOTE_REQUEST_AUDIT_KEYS } from '../services/quote-request-audit-state.js';
import {
  makeApproveQuoteRequestCommand,
  makeAssignQuoteRequestCommand,
  makeCancelQuoteRequestCommand,
  makeCreateOnBehalfCommand,
  makeModifyQuoteRequestCommand,
  makeSetQuoteRequestCustomFieldValuesCommand,
  type QuoteRequestAdminCommandDeps,
  type QuoteRequestOperator,
} from './quote-request-admin-commands.js';

/**
 * Issue #1824 (`specs/186-aggregate-ports/` T064) — the operator's writes on a
 * Quote Request as Commands, the ones the admin routes and
 * `quoteRequestCommandPort` both run. Through the **real** `CommandBus` with a
 * recording audit port over an in-memory EntityManager: one entry per write,
 * the state the hand-written audit recorded before the conversion, the `source`
 * code beside it, nothing on a refusal, and the domain event and the
 * notification record exactly once.
 *
 * `create_on_behalf` and `modify` are held here to the rules
 * `specs/192-quote-request-draft-share/` gives an unshared quote (a create
 * with one line, an edit of the validity alone); their line, revision and
 * group writes are measured against the database in
 * `backend/test/contract/quote_requests/quote-request-command-port.test.ts`.
 */

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const OTHER_ADMIN = '00000000-0000-4000-8000-0000000004a2';
const INELIGIBLE = '00000000-0000-4000-8000-0000000004a3';
const ORG = randomUUID();
const CHANNEL = randomUUID();
const PRODUCT = randomUUID();
const OPERATOR: QuoteRequestOperator = { adminUserId: ADMIN, roleLabel: 'Platform administrator' };
const SYSTEM: QuoteRequestOperator = { adminUserId: null, roleLabel: 'System' };

type Row = Record<string, unknown>;

class FakeEm {
  readonly tables = new Map<string, Row[]>();
  flushes = 0;

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) this.tables.set(name, (rows = []));
    return rows;
  }

  create<T extends object>(entity: new () => T, data: Partial<T>): T {
    const row = Object.assign(new entity(), data);
    this.table(entity.name).push(row as Row);
    return row;
  }

  async findOne(entity: { name: string }, where: Row): Promise<Row | null> {
    return this.table(entity.name).find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null;
  }

  async find(entity: { name: string }, where: Row): Promise<Row[]> {
    return this.table(entity.name).filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
  }

  /** The row lock: answers the stored version, as `select … for update` does. */
  async execute(_sql: string, [id]: [string]): Promise<Array<{ version: number }>> {
    const row = this.table(QuoteRequest.name).find((r) => r['id'] === id);
    return row ? [{ version: this.storedVersion.get(id) ?? (row['version'] as number) }] : [];
  }

  /** A version another writer committed since the entity was read. */
  readonly storedVersion = new Map<string, number>();

  async flush(): Promise<void> {
    this.flushes += 1;
  }

  /** The rows are already in their table: `create` put them there. */
  persist(): this {
    return this;
  }

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function harness() {
  const em = new FakeEm();
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
    record: async () => {
      throw new Error('a Command records through recordWithin');
    },
  };
  const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const events = {
    run: async <T>(fn: () => Promise<T>) => fn(),
    emit: vi.fn((name: string, payload: Record<string, unknown>) => emitted.push({ name, payload })),
  };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  // `forkScopedEm(orm)` answers `orm.em.fork(...)`: the fake is its own fork.
  (em as unknown as { fork: () => FakeEm }).fork = () => em;
  const appended: Array<Record<string, unknown>> = [];
  const recorded: Array<Record<string, unknown>> = [];
  const deps = {
    salesRepAssignment: { canSeeOrganization: async () => false },
    // Issue #1906 — every administrator but INELIGIBLE may be the assignee here.
    assigneeEligibility: vi.fn(async (adminUserId: string) => adminUserId !== INELIGIBLE),
    eventService: {
      append: vi.fn(async (input: Record<string, unknown>) => {
        appended.push(input);
        return { id: randomUUID(), ...input };
      }),
    },
    notificationService: {
      record: vi.fn(async (_em: unknown, input: Record<string, unknown>) => {
        recorded.push(input);
      }),
    },
    // What the create and the edit read besides the request itself.
    customerAccounts: { findById: async (id: string) => ({ id, organizationId: ORG }) },
    channelMembership: { listChannelsForEntity: async () => [{ id: CHANNEL, active: true }] },
    catalogProducts: {
      findByIds: async (ids: string[]) => ids.map((id) => ({ id, name: 'Product', slug: 'product', archivedAt: null })),
    },
    rfqService: { generateBusinessId: async () => 'QR-000192', lineNames: async () => new Map<string, string>() },
    revisionService: {
      byNumber: vi.fn(async () => null),
      record: vi.fn(async () => ({ id: randomUUID(), itemsSnapshot: [] })),
      diffRevisions: vi.fn(() => []),
    },
  } as unknown as QuoteRequestAdminCommandDeps;
  return { em, entries, emitted, commandBus, deps, appended, recorded };
}

function seedQuote(em: FakeEm, extra: Partial<QuoteRequest> = {}): QuoteRequest {
  return em.create(QuoteRequest, {
    id: randomUUID(),
    businessId: 'QR-001824',
    organizationId: ORG,
    customerAccountId: randomUUID(),
    salesChannelId: null,
    status: 'Pending',
    version: 3,
    assignedAdminUserId: OTHER_ADMIN,
    awaitingCustomerRevisionAcceptance: true,
    customFieldValues: { kept: 'value' },
    ...extra,
  } as Partial<QuoteRequest>);
}

function pricedLine(em: FakeEm, quote: QuoteRequest): void {
  em.create(QuoteRequestItem, { id: randomUUID(), quoteRequestId: quote.id, agreedUnitPrice: '10.0000' } as never);
}

const asAdmin = <T>(fn: () => Promise<T>) => withSystemScopeActingFor(ADMIN, 'quote_requests command test', fn);
const asSystem = <T>(fn: () => Promise<T>) => withSystemScope('quote_requests command test', fn);

function onlyAllowedKeys(entries: readonly RecordAuditInput[]): string[] {
  return [
    ...new Set(entries.flatMap((e) => [...Object.keys(e.stateBefore ?? {}), ...Object.keys(e.stateAfter ?? {})])),
  ].filter((key) => !QUOTE_REQUEST_AUDIT_KEYS.has(key));
}

describe('quote_request.approve', () => {
  it('approves, records the entry the hand audit recorded, the history, one notification and one event', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    pricedLine(h.em, quote);

    const result = await asAdmin(() =>
      h.commandBus.run(
        makeApproveQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, note: 'Agreed', expectedVersion: 3 }),
      ),
    );

    expect(result).toBe(quote);
    expect(quote).toMatchObject({ status: 'Approved', version: 4, assignedAdminUserId: ADMIN, awaitingCustomerRevisionAcceptance: false });
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'quote_request.approve',
      objectType: 'quote_request',
      objectId: quote.id,
      actorAdminUserId: ADMIN,
      stateBefore: { status: 'Pending' },
      stateAfter: { status: 'Approved' },
    });
    expect(h.appended.map((e) => e['eventType'])).toEqual(['note-added', 'approved']);
    expect(h.appended[1]).toMatchObject({ actor: { adminUserId: ADMIN, roleLabel: 'Platform administrator' } });
    expect(h.recorded.map((r) => r['change'])).toEqual(['approved']);
    expect(h.emitted.map((e) => e.name)).toEqual(['rfq.approved.v1']);
    expect(h.emitted[0]?.payload).toMatchObject({ rfqId: quote.id });
  });

  it('records the caller’s source code beside a system actor, and keeps the assignee', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    pricedLine(h.em, quote);

    await asSystem(() =>
      h.commandBus.run(
        makeApproveQuoteRequestCommand(h.deps, {
          quoteRequestId: quote.id,
          operator: SYSTEM,
          expectedVersion: null,
          source: 'erp.sync',
        }),
      ),
    );

    expect(h.entries[0]).toMatchObject({
      actorAdminUserId: null,
      stateBefore: { status: 'Pending' },
      stateAfter: { status: 'Approved', source: 'erp.sync' },
    });
    expect(quote.assignedAdminUserId).toBe(OTHER_ADMIN);
    expect(h.appended[0]).toMatchObject({ eventType: 'approved', actor: { adminUserId: null, roleLabel: 'System' } });
    expect(onlyAllowedKeys(h.entries)).toEqual([]);
  });

  it.each([
    ['a stale expected version', { expectedVersion: 2 }, {}, ERROR_CODES.VERSION_CONFLICT],
    ['a row another writer moved', { expectedVersion: null }, { moved: true }, ERROR_CODES.VERSION_CONFLICT],
    ['a request that is not pending', { expectedVersion: null }, { status: 'Approved' }, ERROR_CODES.RFQ_NOT_QUOTED],
    ['an unpriced line', { expectedVersion: null }, { unpriced: true }, ERROR_CODES.QUOTE_INCOMPLETE],
  ] as const)('refuses %s and records, notifies and emits nothing', async (_what, input, setup, code) => {
    const h = harness();
    const quote = seedQuote(h.em, 'status' in setup ? { status: setup.status } : {});
    if ('unpriced' in setup) h.em.create(QuoteRequestItem, { quoteRequestId: quote.id, agreedUnitPrice: null } as never);
    else pricedLine(h.em, quote);
    if ('moved' in setup) h.em.storedVersion.set(quote.id, 4);

    await expect(
      asAdmin(() => h.commandBus.run(makeApproveQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, ...input }))),
    ).rejects.toMatchObject({ code });
    expect(h.entries).toEqual([]);
    expect(h.recorded).toEqual([]);
    expect(h.emitted).toEqual([]);
  });

  it('answers an id outside the operator’s reach exactly as an unknown one', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    // A sales representative's scope: not platform-wide, and `canSeeOrganization` says no.
    const deps = { ...h.deps, isPlatformAdmin: () => false };
    await expect(
      asAdmin(() =>
        h.commandBus.run(makeApproveQuoteRequestCommand(deps, { quoteRequestId: quote.id, operator: OPERATOR, expectedVersion: null })),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
    expect(h.entries).toEqual([]);
  });
});

describe('quote_request.cancel', () => {
  it('cancels and records whether a reason was given, never the reason', async () => {
    const h = harness();
    const quote = seedQuote(h.em, { status: 'Created from admin' } as Partial<QuoteRequest>);

    await asAdmin(() =>
      h.commandBus.run(
        makeCancelQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, reason: 'S1824-REASON', expectedVersion: null }),
      ),
    );

    expect(quote).toMatchObject({ status: 'Canceled', cancellationReason: 'S1824-REASON', version: 4 });
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({ action: 'quote_request.cancel', stateBefore: null, stateAfter: { status: 'Canceled', hasReason: true } });
    expect(JSON.stringify(h.entries)).not.toContain('S1824-REASON');
    expect(h.recorded.map((r) => r['change'])).toEqual(['canceled']);
    expect(h.emitted.map((e) => [e.name, e.payload['reason']])).toEqual([['rfq.canceled.v1', 'S1824-REASON']]);
  });

  it('cancels a quote its customer cannot see without telling the customer, and still announces it (192, FR-005)', async () => {
    const h = harness();
    const quote = seedQuote(h.em, { status: 'Created from admin', sharedWithCustomer: false } as Partial<QuoteRequest>);

    await asAdmin(() =>
      h.commandBus.run(makeCancelQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, expectedVersion: null })),
    );

    expect(quote).toMatchObject({ status: 'Canceled', sharedWithCustomer: false });
    expect(h.appended.map((e) => e['eventType'])).toEqual(['canceled']);
    expect(h.recorded).toEqual([]);
    expect(h.emitted.map((e) => e.name)).toEqual(['rfq.canceled.v1']);
  });

  it('refuses an approved request with 409 RFQ_NOT_QUOTED', async () => {
    const h = harness();
    const quote = seedQuote(h.em, { status: 'Approved' } as Partial<QuoteRequest>);
    await expect(
      asAdmin(() =>
        h.commandBus.run(makeCancelQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, expectedVersion: null })),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.RFQ_NOT_QUOTED });
    expect(h.entries).toEqual([]);
  });
});

describe('quote_request.assign', () => {
  it('records the assignee before and after, and notifies nobody', async () => {
    const h = harness();
    const quote = seedQuote(h.em);

    await asAdmin(() =>
      h.commandBus.run(
        makeAssignQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, adminUserId: ADMIN, expectedVersion: null }),
      ),
    );

    expect(quote).toMatchObject({ assignedAdminUserId: ADMIN, version: 4 });
    expect(h.entries[0]).toMatchObject({
      action: 'quote_request.assign',
      stateBefore: { assignedAdminUserId: OTHER_ADMIN },
      stateAfter: { assignedAdminUserId: ADMIN },
    });
    expect(h.recorded).toEqual([]);
    expect(h.emitted).toEqual([]);
  });

  it('clears the assignee with null', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    await asSystem(() =>
      h.commandBus.run(
        makeAssignQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: SYSTEM, adminUserId: null, expectedVersion: 3 }),
      ),
    );
    expect(quote.assignedAdminUserId).toBeNull();
    expect(h.entries[0]).toMatchObject({ actorAdminUserId: null, stateAfter: { assignedAdminUserId: null } });
    expect(h.deps.assigneeEligibility).not.toHaveBeenCalled();
  });

  it('asks the one assignee rule about the target, for the request’s Organization (issue #1906)', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    await asAdmin(() =>
      h.commandBus.run(
        makeAssignQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, adminUserId: ADMIN, expectedVersion: null }),
      ),
    );
    expect(h.deps.assigneeEligibility).toHaveBeenCalledWith(ADMIN, ORG);
  });

  it('refuses a target who may not handle the request with 422 RFQ_ASSIGNEE_NOT_ELIGIBLE, writing nothing (issue #1906)', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    const refused = await asAdmin(() =>
      h.commandBus.run(
        makeAssignQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, adminUserId: INELIGIBLE, expectedVersion: null }),
      ),
    ).then(
      () => null,
      (error: unknown) => error as { statusCode?: number; code?: string },
    );
    expect(refused).toMatchObject({ statusCode: 422, code: ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE });
    expect(quote).toMatchObject({ assignedAdminUserId: OTHER_ADMIN, version: 3 });
    expect(h.entries).toEqual([]);
  });

  it('refuses a malformed target the same way, before asking who it is', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    await expect(
      asAdmin(() =>
        h.commandBus.run(
          makeAssignQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, adminUserId: 'nope', expectedVersion: null }),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE });
    expect(h.deps.assigneeEligibility).not.toHaveBeenCalled();
  });
});

describe('quote_request.custom_fields.update', () => {
  it('stores the merge’s answer and names the changed keys, never their values', async () => {
    const h = harness();
    const quote = seedQuote(h.em);

    await asSystem(() =>
      h.commandBus.run(
        makeSetQuoteRequestCustomFieldValuesCommand({
          quoteRequestId: quote.id,
          operator: SYSTEM,
          expectedVersion: null,
          source: 'pim',
          merge: async (current) => ({ ...current, tender: 'S1824-CF' }),
          salesRepAssignment: h.deps.salesRepAssignment,
        }),
      ),
    );

    expect(quote.customFieldValues).toEqual({ kept: 'value', tender: 'S1824-CF' });
    expect(quote.version).toBe(4);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'quote_request.custom_fields.update',
      stateBefore: null,
      stateAfter: { changedCustomFields: ['tender'], source: 'pim' },
    });
    expect(JSON.stringify(h.entries)).not.toContain('S1824-CF');
    expect(h.recorded).toEqual([]);
    expect(onlyAllowedKeys(h.entries)).toEqual([]);
  });

  it('writes and records nothing when the merge changes nothing', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    await asSystem(() =>
      h.commandBus.run(
        makeSetQuoteRequestCustomFieldValuesCommand({
          quoteRequestId: quote.id,
          operator: SYSTEM,
          expectedVersion: null,
          merge: async (current) => ({ ...current }),
          salesRepAssignment: h.deps.salesRepAssignment,
        }),
      ),
    );
    expect(quote.version).toBe(3);
    expect(h.entries).toEqual([]);
  });

  it('lets a throwing merge propagate unchanged and writes nothing', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    const refusal = new Error('invalid');
    await expect(
      asSystem(() =>
        h.commandBus.run(
          makeSetQuoteRequestCustomFieldValuesCommand({
            quoteRequestId: quote.id,
            operator: SYSTEM,
            expectedVersion: null,
            merge: async () => {
              throw refusal;
            },
            salesRepAssignment: h.deps.salesRepAssignment,
          }),
        ),
      ),
    ).rejects.toBe(refusal);
    expect(quote.customFieldValues).toEqual({ kept: 'value' });
    expect(h.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `specs/192-quote-request-draft-share/` — the rules an unshared quote keeps,
// carried into the operator's Commands (issue #1824).
// ---------------------------------------------------------------------------

describe('quote_request.create_on_behalf — an unshared quote (192)', () => {
  const createBody = (extra: Record<string, unknown> = {}) =>
    ({
      organizationId: ORG,
      customerAccountId: randomUUID(),
      salesChannelId: CHANNEL,
      items: [{ productId: PRODUCT, quantity: 2 }],
      ...extra,
    }) as never;

  /** The create as a platform-wide administrator runs it, with the setting's default. */
  async function create(h: ReturnType<typeof harness>, body: never, defaultDays = 30) {
    const resolveDefaultValidityDays = vi.fn(async () => defaultDays);
    const deps = { ...h.deps, isPlatformAdmin: () => true, resolveDefaultValidityDays };
    const quote = await asAdmin(() => h.commandBus.run(makeCreateOnBehalfCommand(deps, { operator: OPERATOR, body })));
    return { quote, resolveDefaultValidityDays };
  }

  it('starts unshared, with no date, the default days snapshotted, and records nothing for the customer (FR-001, FR-005, FR-031)', async () => {
    const h = harness();
    const { quote } = await create(h, createBody());

    expect(quote).toMatchObject({
      status: 'Created from admin',
      sharedWithCustomer: false,
      shareValidityDays: 30,
      expiresAt: null,
    });
    // An unpriced line is accepted while the quote is unshared (FR-013).
    expect(h.em.table(QuoteRequestItem.name)).toEqual([expect.objectContaining({ productId: PRODUCT, agreedUnitPrice: null })]);
    expect(h.appended.map((e) => e['eventType'])).toEqual(['created', 'note-added']);
    // `prepared` belongs to the share, so nothing is recorded — and nothing is to be delivered.
    expect(h.recorded).toEqual([]);
    expect(h.emitted.map((e) => e.name)).toEqual(['rfq.created_by_admin.v1']);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'quote_request.create_on_behalf',
      stateAfter: { status: 'Created from admin', sharedWithCustomer: false, shareValidityDays: 30 },
    });
  });

  it.each([
    ['days the operator sent', 14, 14],
    ['0, read as no deadline', 0, null],
    ['null, read as no deadline', null, null],
  ] as const)('keeps %s instead of the default, without reading it (FR-032)', async (_what, sent, stored) => {
    const h = harness();
    const { quote, resolveDefaultValidityDays } = await create(h, createBody({ expiresInDays: sent }));
    expect(quote).toMatchObject({ sharedWithCustomer: false, shareValidityDays: stored, expiresAt: null });
    expect(resolveDefaultValidityDays).not.toHaveBeenCalled();
    expect(h.recorded).toEqual([]);
  });

  it('snapshots a default of 0 as no deadline (R-12)', async () => {
    const h = harness();
    const { quote } = await create(h, createBody(), 0);
    expect(quote).toMatchObject({ shareValidityDays: null, expiresAt: null });
  });
});

describe('quote_request.modify — validity and the revised notification (192)', () => {
  const modify = (h: ReturnType<typeof harness>, quote: QuoteRequest, body: Record<string, unknown>) =>
    asAdmin(() =>
      h.commandBus.run(
        makeModifyQuoteRequestCommand(h.deps, { quoteRequestId: quote.id, operator: OPERATOR, expectedVersion: null, body: body as never }),
      ),
    );

  it('stores the days on an unshared quote, writes no date and records no revised (R-10, FR-005)', async () => {
    const h = harness();
    const quote = seedQuote(h.em, {
      status: 'Created from admin',
      sharedWithCustomer: false,
      shareValidityDays: 30,
      expiresAt: null,
      currentRevisionNumber: 1,
    } as Partial<QuoteRequest>);

    await modify(h, quote, { expiresInDays: 10 });

    expect(quote).toMatchObject({ sharedWithCustomer: false, shareValidityDays: 10, expiresAt: null, currentRevisionNumber: 2, version: 4 });
    expect(h.appended).toEqual([
      expect.objectContaining({ eventType: 'modified', payload: expect.objectContaining({ validityDays: { before: 30, after: 10 } }) }),
    ]);
    expect(h.recorded).toEqual([]);
    // The event is emitted for an unshared quote too; a customer-facing subscriber checks the flag.
    expect(h.emitted.map((e) => e.name)).toEqual(['rfq.modified.v1']);
  });

  it('reads 0 on an unshared quote as no deadline', async () => {
    const h = harness();
    const quote = seedQuote(h.em, {
      status: 'Created from admin',
      sharedWithCustomer: false,
      shareValidityDays: 30,
      currentRevisionNumber: 1,
    } as Partial<QuoteRequest>);
    await modify(h, quote, { expiresInDays: 0 });
    expect(quote.shareValidityDays).toBeNull();
    expect(quote.expiresAt ?? null).toBeNull();
  });

  it('clears the deadline of a shared quote on 0 — never "expires now" — and records revised (owner decision 2026-11-24)', async () => {
    const h = harness();
    const deadline = new Date(Date.now() + 5 * 86_400_000);
    const quote = seedQuote(h.em, { sharedWithCustomer: true, expiresAt: deadline, currentRevisionNumber: 1 } as Partial<QuoteRequest>);

    await modify(h, quote, { expiresInDays: 0 });

    expect(quote.expiresAt).toBeNull();
    expect(h.appended).toEqual([
      expect.objectContaining({
        eventType: 'modified',
        payload: expect.objectContaining({ validity: { before: deadline.toISOString(), after: null } }),
      }),
    ]);
    expect(h.recorded.map((r) => r['change'])).toEqual(['revised']);
  });

  it('dates a shared quote from now by the days sent', async () => {
    const h = harness();
    const quote = seedQuote(h.em, { sharedWithCustomer: true, expiresAt: null, currentRevisionNumber: 1 } as Partial<QuoteRequest>);
    const before = Date.now();
    await modify(h, quote, { expiresInDays: 7 });
    const at = quote.expiresAt!.getTime();
    expect(at).toBeGreaterThanOrEqual(before + 7 * 86_400_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);
    expect(h.recorded.map((r) => r['change'])).toEqual(['revised']);
  });
});
