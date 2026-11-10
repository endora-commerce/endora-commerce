/**
 * The audit-state rule for Quote Requests (`specs/conventions/audit-state.md`,
 * D-288, issue #470): the platform audit log carries **names and structure** of
 * a Quote Request, never its values. The values a Quote Request's history shows
 * — its lines, prices, notes, group names, a cancellation's reason, the
 * addresses a PDF went to — are already the module's own: the revisions and
 * the history events, read under the quote's own reach. Nothing reads them back
 * out of the audit log.
 *
 * The Commands (`quote_request.custom_fields.carry`,
 * `quote_request.send_document`) run through the **real** `CommandBus` with a
 * recording audit port; the EntityManager is an in-memory stand-in. The writes
 * that record through the audit port directly are held to the same sentinels
 * through their state builders.
 */
import { AssertionError } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionalEmailSendInput } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { makeSendDocumentCommand, type DocumentCommandDeps } from '../commands/document-template-commands.js';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { groupingShape, planLineGrouping } from './line-grouping.js';
import { QUOTE_REQUEST_AUDIT_KEYS, cancelAuditState, prepareBasketAuditState } from './quote-request-audit-state.js';
import { QuoteRequestCustomFieldCarryReceiver } from './quote-request-custom-field-carry-receiver.js';

// ---------------------------------------------------------------------------
// The sentinel assertion. A local copy of `expectNoAuditValues` from
// `@endora-commerce/test-kit/audit` (#1004): this branch is not stacked on it.
// Replace this block with the import once #1004 has merged.
// ---------------------------------------------------------------------------
type Sentinel = string | number;
type AuditState = Pick<RecordAuditInput, 'action' | 'stateBefore' | 'stateAfter'>;

function leaksOf(entries: readonly AuditState[], sentinels: readonly Sentinel[]): string[] {
  const leaks: string[] = [];
  const hit = (text: string, sentinel: Sentinel) =>
    typeof sentinel === 'number' ? text.includes(String(sentinel)) : text.toLowerCase().includes(sentinel.toLowerCase());
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined || value instanceof Date) return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        for (const sentinel of sentinels) if (typeof sentinel === 'string' && hit(key, sentinel)) leaks.push(`${path}{${key}}`);
        walk(child, `${path}.${key}`);
      }
      return;
    }
    for (const sentinel of sentinels) {
      if (typeof value === 'number' ? value === sentinel : hit(String(value), sentinel)) {
        leaks.push(`${path} = ${JSON.stringify(value)}`);
      }
    }
  };
  entries.forEach((entry, index) => {
    walk(entry.stateBefore, `[${index}] ${entry.action} stateBefore`);
    walk(entry.stateAfter, `[${index}] ${entry.action} stateAfter`);
  });
  return leaks;
}

function expectNoAuditValues(entries: readonly AuditState[], sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const leaks = leaksOf(entries, sentinels);
  if (leaks.length > 0) {
    throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
  }
}
// ---------------------------------------------------------------------------

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const ORG = randomUUID();
const CUSTOMER = randomUUID();
const OPPORTUNITY = randomUUID();
const GROUP = randomUUID();

const S = {
  customField: 'S470-CF',
  carried: 'S470-CF-CARRIED',
  reason: 'S470-REASON',
  group: 'S470-GROUP',
  groupNew: 'S470-GROUP-NEW',
  email: 's470@example.test',
  emailFailed: 's470-failed@example.test',
} as const;

const SENTINELS: readonly Sentinel[] = [...Object.values(S), ORG, CUSTOMER];

function topLevelKeys(entries: readonly AuditState[]): string[] {
  return [
    ...new Set(entries.flatMap((entry) => [...Object.keys(entry.stateBefore ?? {}), ...Object.keys(entry.stateAfter ?? {})])),
  ].sort();
}

function expectOnlyAllowedKeys(entries: readonly AuditState[]): void {
  expect(topLevelKeys(entries).filter((key) => !QUOTE_REQUEST_AUDIT_KEYS.has(key))).toEqual([]);
}

type Row = Record<string, unknown>;

class FakeEm {
  readonly tables = new Map<string, Row[]>();

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

  persist(row: object): this {
    const rows = this.table(row.constructor.name);
    if (!rows.includes(row as Row)) rows.push(row as Row);
    return this;
  }

  async findOne(entity: { name: string }, where: Row): Promise<Row | null> {
    return this.table(entity.name).find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null;
  }

  async flush(): Promise<void> {}

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }

  fork(): this {
    return this;
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
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  return { em, entries, commandBus };
}

function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  return withSystemScopeActingFor(ADMIN, 'quote_requests audit-state sentinel test', fn);
}

function seedQuote(em: FakeEm): QuoteRequest {
  return em.create(QuoteRequest, {
    id: randomUUID(),
    businessId: 'QR-000470',
    organizationId: ORG,
    customerAccountId: CUSTOMER,
    salesChannelId: null,
    status: 'Pending',
    version: 3,
    customFieldValues: { risk: S.customField },
  } as Partial<QuoteRequest>);
}

describe('quote_requests audit state carries names, never values (#470)', () => {
  it('quote_request.custom_fields.carry — names the carried keys, never their values', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    const receiver = new QuoteRequestCustomFieldCarryReceiver({
      commandBus: h.commandBus,
      customFieldCarry: {
        plan: async ({
          sourceValues,
          targetValues,
        }: {
          sourceValues: Record<string, unknown>;
          targetValues: Record<string, unknown>;
        }) => ({
          values: { ...targetValues, channel: sourceValues.channel },
          carried: ['channel'],
          skipped: [{ key: 'risk', reason: 'target_not_empty' as never }],
        }),
      } as never,
    });

    const receipt = await asAdmin(() =>
      receiver.receiveCarriedValues({
        recordId: quote.id,
        organizationId: ORG,
        source: { entityType: 'opportunity', recordId: OPPORTUNITY, reference: 'OPP-000470', values: { channel: S.carried } },
      }),
    );

    expect(receipt.outcome).toBe('applied');
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.action).toBe('quote_request.custom_fields.carry');
    expect(h.entries[0]?.stateAfter).toMatchObject({
      changedCustomFields: ['channel'],
      customFieldCarry: { carried: ['channel'], skipped: [{ key: 'risk' }], source: { reference: 'OPP-000470' } },
    });
    expect(quote.customFieldValues).toEqual({ risk: S.customField, channel: S.carried });
    expectOnlyAllowedKeys(h.entries);
  });

  it('quote_request.send_document — how many it went to, never the addresses', async () => {
    const h = harness();
    const quote = seedQuote(h.em);
    const sender = {
      send: vi.fn(async (input: TransactionalEmailSendInput) => {
        if (input.to === S.emailFailed) throw new Error('mailbox unavailable');
        return { status: 'sent' as const };
      }),
    };
    const deps: DocumentCommandDeps = {
      isPlatformAdmin: () => true,
      salesRepScope: { canSeeOrganization: async () => true },
      listChoices: async () => ({ templates: [], effectiveDefaultId: null, builtInLanguages: ['en-US'] }),
      sender: () => sender as never,
      log: () => undefined,
    };

    await asAdmin(() =>
      h.commandBus.run(
        makeSendDocumentCommand(
          {
            quoteRequestId: quote.id,
            sendId: randomUUID(),
            salesChannelId: null,
            language: 'en-US',
            recipients: [S.email, S.emailFailed],
            message: null,
            roleLabel: null,
            variables: {},
            pdf: { templateId: null, templateName: null, fileName: 'QR-000470.pdf', bytes: Buffer.from('%PDF') },
          } as never,
          deps,
        ),
      ),
    );

    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.action).toBe('quote_request.send_document');
    expect(h.entries[0]?.stateAfter).toMatchObject({ language: 'en-US', recipientCount: 1, failedRecipientCount: 1 });
    expectOnlyAllowedKeys(h.entries);
  });

  it('quote_request.cancel — whether a reason was given, never the reason', () => {
    const entries = [{ action: 'quote_request.cancel', stateBefore: null, stateAfter: cancelAuditState(S.reason) }];
    expectNoAuditValues(entries, SENTINELS);
    expect(entries[0]?.stateAfter).toEqual({ status: 'Canceled', hasReason: true });
    expect(cancelAuditState(undefined)).toEqual({ status: 'Canceled', hasReason: false });
    expectOnlyAllowedKeys(entries);
  });

  it('quote_request.prepare_customer_basket — the basket and its size, not the customer', () => {
    const cartId = randomUUID();
    const entries = [
      {
        action: 'quote_request.prepare_customer_basket',
        stateBefore: null,
        stateAfter: prepareBasketAuditState({ cartId, customerAccountId: CUSTOMER, itemCount: 2 }),
      },
    ];
    expectNoAuditValues(entries, SENTINELS);
    expect(entries[0]?.stateAfter).toEqual({ cartId, itemCount: 2 });
    expectOnlyAllowedKeys(entries);
  });

  it('quote_request.modify / .create_on_behalf — the grouping by line counts, never a group name', () => {
    const plan = planLineGrouping({
      storedGroups: [{ id: GROUP, name: S.group, position: 0 }],
      pairedRows: [{ groupId: GROUP }],
      body: { groups: [{ key: 'g', id: GROUP, name: S.groupNew }], items: [{ groupKey: 'g' }, { groupKey: 'g' }] },
    } as never);
    const entries = [
      {
        action: 'quote_request.modify',
        stateBefore: { groups: groupingShape([{ id: GROUP, name: S.group, position: 0 } as never], [GROUP]) },
        stateAfter: { currentRevisionNumber: 2, status: 'Pending', groups: plan.after },
      },
    ];
    expectNoAuditValues(entries, SENTINELS);
    expect(entries[0]?.stateBefore).toEqual({ groups: [{ lineCount: 1 }] });
    expect(entries[0]?.stateAfter.groups).toEqual([{ lineCount: 2 }]);
    expectOnlyAllowedKeys(entries);
  });
});
