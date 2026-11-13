/**
 * The audit-state rule for CRM (`specs/conventions/audit-state.md`, D-288,
 * issue #470): the platform audit log carries **names and structure** of an
 * Opportunity, never its values. The values the Opportunity's history shows
 * live in `crm_opportunity_value_changes`, written in the same Command.
 *
 * One sentinel test per Command that writes an Opportunity or a child of one,
 * each run through the **real** `CommandBus` with a recording audit port. The
 * EntityManager is an in-memory stand-in: what is under test is what the
 * Command hands the bus, not SQL. The rollback, the reach and the
 * `custom_fields:read` gate are the integration suite's
 * (`backend/test/integration/crm/opportunity-value-changes.test.ts`).
 */
import { AssertionError } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import { CrmOpportunityStatus } from '../entities/crm-opportunity-status.entity.js';
import { CrmOpportunityTag } from '../entities/crm-opportunity-tag.entity.js';
import { CrmOrderStatusMapping } from '../entities/crm-order-status-mapping.entity.js';
import { OpportunityAttachmentService } from './opportunity-attachment-service.js';
import { OpportunityEventService } from './opportunity-event-service.js';
import { OpportunityLinkService } from './opportunity-link-service.js';
import { OpportunityService } from './opportunity-service.js';
import { OpportunityTransitionService } from './opportunity-transition-service.js';
import { OrderStatusPropagationService } from './order-status-propagation-service.js';

// ---------------------------------------------------------------------------
// The sentinel assertion. A local copy of `expectNoAuditValues` from
// `@endora-commerce/test-kit/audit` (#1004): this branch is not stacked on it.
// Replace this block with the import once #1004 has merged.
// ---------------------------------------------------------------------------
type Sentinel = string | number;

function leaksOf(entries: readonly RecordAuditInput[], sentinels: readonly Sentinel[]): string[] {
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

function expectNoAuditValues(entries: readonly RecordAuditInput[], sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const leaks = leaksOf(entries, sentinels);
  if (leaks.length > 0) {
    throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
  }
}
// ---------------------------------------------------------------------------

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const ORG = randomUUID();
const CONTACT = randomUUID();
const OTHER_CONTACT = randomUUID();
const TAG = '00000000-0000-4000-8000-0000000004c1';
const ORDER = '00000000-0000-4000-8000-0000000004d1';
const ASSET = '00000000-0000-4000-8000-0000000004e1';

const S = {
  title: 'S470-TITLE',
  titleNew: 'S470-TITLE-NEW',
  description: 'S470-DESC',
  descriptionNew: 'S470-DESC-NEW',
  amount: '470470.47',
  amountNew: '470471.47',
  customField: 'S470-CF',
  customFieldNew: 'S470-CF-NEW',
  tag: 'S470-TAG',
  event: 'S470-EVENT',
  eventNew: 'S470-EVENT-NEW',
  file: 'S470-FILE.pdf',
  reason: 'S470-REASON',
} as const;

const SENTINELS: readonly Sentinel[] = [
  ...Object.values(S),
  470470.47,
  470471.47,
  ORG,
  CONTACT,
  OTHER_CONTACT,
];

/** Every key a `crm.opportunity.*` audit state may hold at its top level (the allowlist, by its use). */
function topLevelKeys(entries: readonly RecordAuditInput[]): string[] {
  return [
    ...new Set(entries.flatMap((entry) => [...Object.keys(entry.stateBefore ?? {}), ...Object.keys(entry.stateAfter ?? {})])),
  ].sort();
}

// ---------------------------------------------------------------------------
// An in-memory EntityManager: enough of MikroORM's surface for the Commands
// under test, keyed by entity class name.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

class FakeEm {
  readonly tables = new Map<string, Row[]>();
  #sequence = 0;

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return rows;
  }

  #matches(row: Row, where: Where = {}): boolean {
    return Object.entries(where).every(([key, wanted]) => {
      if (wanted !== null && typeof wanted === 'object' && !Array.isArray(wanted)) {
        const operators = wanted as Record<string, unknown>;
        if (Array.isArray(operators.$in)) return operators.$in.includes(row[key]);
        return true;
      }
      return row[key] === wanted;
    });
  }

  seed<T extends object>(entity: new () => T, data: Partial<T>): T {
    return this.create(entity, data as never);
  }

  create<T extends object>(entity: new () => T, data: Partial<T>): T {
    const row = Object.assign(new entity(), data);
    this.table(entity.name).push(row as Row);
    return row;
  }

  persist(row: object): this {
    const name = row.constructor.name;
    if (!this.table(name).includes(row as Row)) this.table(name).push(row as Row);
    return this;
  }

  async findOne(entity: { name: string }, where: Where): Promise<Row | null> {
    return this.table(entity.name).find((row) => this.#matches(row, where)) ?? null;
  }

  async findOneOrFail(entity: { name: string }, where: Where): Promise<Row> {
    const row = await this.findOne(entity, where);
    if (!row) throw new Error(`${entity.name} not found`);
    return row;
  }

  async find(entity: { name: string }, where: Where = {}): Promise<Row[]> {
    return this.table(entity.name).filter((row) => this.#matches(row, where));
  }

  async count(entity: { name: string }, where: Where = {}): Promise<number> {
    // A Sales Channel is a platform record this stand-in does not hold: it exists.
    if (entity.name === 'SalesChannel') return 1;
    return (await this.find(entity, where)).length;
  }

  remove(row: object): this {
    const rows = this.table(row.constructor.name);
    const index = rows.indexOf(row as Row);
    if (index >= 0) rows.splice(index, 1);
    return this;
  }

  async nativeDelete(entity: { name: string }, where: Where): Promise<number> {
    const rows = this.table(entity.name);
    const doomed = rows.filter((row) => this.#matches(row, where));
    for (const row of doomed) rows.splice(rows.indexOf(row), 1);
    return doomed.length;
  }

  async execute(sql: string): Promise<Array<{ value: number }>> {
    if (sql.includes('nextval')) return [{ value: (this.#sequence += 1) }];
    return [];
  }

  async flush(): Promise<void> {}

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }

  fork(): this {
    return this;
  }

  /** The rows of the value store, by its class name. */
  valueChanges(): Row[] {
    return this.table('CrmOpportunityValueChange');
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
    query: async () => [],
    findByObjectIds: async () => [],
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  return { em, entries, commandBus, events };
}

/** An administrator's Command, with every Organization in reach: reach is the integration suite's subject. */
function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  return withSystemScopeActingFor(ADMIN, 'crm audit-state sentinel test', fn);
}

function seedOpportunity(em: FakeEm, overrides: Partial<CrmOpportunity> = {}): CrmOpportunity {
  em.seed(CrmOpportunityStatus, { code: 'new', kind: 'open' } as never);
  em.seed(CrmOpportunityStatus, { code: 'lost', kind: 'lost' } as never);
  return em.seed(CrmOpportunity, {
    id: randomUUID(),
    number: 'OPP-000470',
    title: S.title,
    description: S.description,
    organizationId: ORG,
    customerAccountId: CONTACT,
    statusCode: 'new',
    valueMode: 'manual',
    manualValue: S.amount,
    currency: 'PLN',
    customFieldValues: { risk: S.customField },
    version: 3,
    ...overrides,
  });
}

function opportunityService(h: ReturnType<typeof harness>) {
  const service = new OpportunityService({
    emFactory: () => h.em,
    commandBus: h.commandBus,
    workflowRead: { loadGraph: async () => ({ initial: () => ({ code: 'new' }) }) },
    organizations: { findById: async (id: string) => ({ id }) },
    customerAccounts: { findInOrganization: async (id: string) => ({ id }) },
    adminUsers: { findByIds: async () => [] },
    assignment: {
      resolveDefault: async () => null,
      assertAssignable: async () => undefined,
      notifyAssigned: async () => undefined,
    },
    tags: { resolve: async (_em: unknown, ids: readonly string[]) => ids.map((id) => ({ id, name: S.tag })) },
    customFields: {
      validateAndMerge: async (_type: string, current: Record<string, unknown>, patch: Record<string, unknown>) => ({
        ...current,
        ...patch,
      }),
    },
    customFieldCarry: { plan: async () => ({ values: {}, carried: [], skipped: [] }) },
    references: { rowsFor: () => [] },
    mentions: { tell: async () => undefined },
    recalculateValue: async () => undefined,
    warn: () => undefined,
  } as never);
  // The read back after a write renders the detail screen; it is not under test.
  vi.spyOn(service, 'get').mockResolvedValue({} as never);
  return service;
}

/** The value-store row an entry points at — and that it is the Opportunity's. */
function storedFor(h: ReturnType<typeof harness>, entry: RecordAuditInput): Row {
  const pointer = (entry.stateAfter?.valueChangeId ?? entry.stateBefore?.valueChangeId) as string | undefined;
  expect(pointer, `${entry.action} carries a valueChangeId`).toEqual(expect.any(String));
  const row = h.em.valueChanges().find((change) => change.id === pointer);
  expect(row, `${entry.action}'s value-store row`).toBeDefined();
  expect(row?.opportunityId).toBe(entry.objectId);
  return row as Row;
}

describe('crm audit state carries names, never values (#470)', () => {
  it('crm.opportunity.create — the values go to the store, the entry names them', async () => {
    const h = harness();
    h.em.seed(CrmOpportunityStatus, { code: 'new', kind: 'open' } as never);
    await asAdmin(() =>
      opportunityService(h).create({
        title: S.title,
        description: S.description,
        organizationId: ORG,
        customerAccountId: CONTACT,
        assignedAdminUserId: null,
        manualValue: S.amount,
        currency: 'PLN',
        tagIds: [TAG],
        customFieldValues: { risk: S.customField },
      } as never),
    );

    expectNoAuditValues(h.entries, SENTINELS);
    const [entry] = h.entries;
    expect(entry?.action).toBe('crm.opportunity.create');
    expect(entry?.stateAfter?.changedFields).toEqual([
      'currency',
      'customerAccountId',
      'description',
      'manualValue',
      'organizationId',
      'tags',
      'title',
    ]);
    expect(entry?.stateAfter?.changedCustomFields).toEqual(['risk']);
    const stored = storedFor(h, entry!);
    expect(stored.before).toBeNull();
    expect(stored.after).toMatchObject({
      title: S.title,
      description: S.description,
      organizationId: ORG,
      customerAccountId: CONTACT,
      manualValue: S.amount,
      currency: 'PLN',
      tags: [S.tag],
      customFieldValues: { risk: S.customField },
    });
  });

  it('crm.opportunity.update — names what changed, the store holds before and after', async () => {
    const h = harness();
    const opportunity = seedOpportunity(h.em);
    h.em.seed(CrmOpportunityTag, { opportunityId: opportunity.id, tagId: TAG } as never);
    await asAdmin(() =>
      opportunityService(h).update(
        opportunity.id,
        {
          title: S.titleNew,
          description: S.descriptionNew,
          customerAccountId: OTHER_CONTACT,
          manualValue: S.amountNew,
          tagIds: [],
          customFieldValues: { risk: S.customFieldNew },
        } as never,
        null,
      ),
    );

    expectNoAuditValues(h.entries, SENTINELS);
    const [entry] = h.entries;
    expect(entry?.stateAfter?.changedFields).toEqual(['customerAccountId', 'description', 'manualValue', 'tags', 'title']);
    expect(entry?.stateAfter?.changedCustomFields).toEqual(['risk']);
    const stored = storedFor(h, entry!);
    expect(stored.before).toEqual({
      title: S.title,
      description: S.description,
      customerAccountId: CONTACT,
      manualValue: S.amount,
      tags: [S.tag],
      customFieldValues: { risk: S.customField },
    });
    expect(stored.after).toEqual({
      title: S.titleNew,
      description: S.descriptionNew,
      customerAccountId: OTHER_CONTACT,
      manualValue: S.amountNew,
      tags: [],
      customFieldValues: { risk: S.customFieldNew },
    });
  });

  it('crm.opportunity.update — a change of nothing but the status-shaped fields writes no store row', async () => {
    const h = harness();
    const opportunity = seedOpportunity(h.em);
    await asAdmin(() =>
      opportunityService(h).update(opportunity.id, { expectedCloseDate: '2026-12-31' } as never, null),
    );
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toMatchObject({ expectedCloseDate: '2026-12-31' });
    expect(h.entries[0]?.stateAfter).not.toHaveProperty('valueChangeId');
    expect(h.em.valueChanges()).toEqual([]);
  });

  it('crm.opportunity.delete — the entry says which Opportunity by its number', async () => {
    const h = harness();
    const opportunity = seedOpportunity(h.em);
    await asAdmin(() => opportunityService(h).delete(opportunity.id));
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateBefore).toMatchObject({ number: 'OPP-000470', statusCode: 'new' });
  });

  it('crm.opportunity.tag_set — tag names go to the store', async () => {
    const h = harness();
    const opportunity = seedOpportunity(h.em);
    await asAdmin(() => opportunityService(h).setTags(opportunity.id, [TAG]));
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter?.changedFields).toEqual(['tags']);
    const stored = storedFor(h, h.entries[0]!);
    expect(stored).toMatchObject({ before: { tags: [] }, after: { tags: [S.tag] } });
  });

  it('crm.opportunity.link_add — carried custom-field values go to the store', async () => {
    const h = harness();
    const opportunity = seedOpportunity(h.em, { customFieldValues: {} });
    const links = new OpportunityLinkService({
      emFactory: () => h.em,
      commandBus: h.commandBus,
      customFieldCarry: {
        plan: async () => ({ values: { risk: S.customField }, carried: ['risk'], skipped: [] }),
      },
      warn: () => undefined,
      linksChanged: async () => undefined,
    } as never);
    await asAdmin(() =>
      links.linkAutomatically({
        opportunityId: opportunity.id,
        documentKind: 'order',
        documentId: ORDER,
        linkSource: 'auto',
        carry: { sourceType: 'quote_request', recordId: ORDER, sourceValues: { risk: S.customField } },
      } as never),
    );
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter?.changedCustomFields).toEqual(['risk']);
    const stored = storedFor(h, h.entries[0]!);
    expect(stored).toMatchObject({ before: { customFieldValues: { risk: null } }, after: { customFieldValues: { risk: S.customField } } });
  });

  it('crm.opportunity.transition — the reason goes to the store', async () => {
    const h = harness();
    const opportunity = seedOpportunity(h.em);
    const transitions = new OpportunityTransitionService({
      emFactory: () => h.em,
      commandBus: h.commandBus,
      events: h.events,
      workflowRead: {
        loadGraph: async () => ({
          kindOf: (code: string) => (code === 'lost' ? 'lost' : code === 'new' ? 'open' : undefined),
          canTransition: () => true,
        }),
      },
      guards: { run: async () => undefined },
      propagation: { forwardTargets: async () => [], resolve: async () => [] },
    } as never);
    await asAdmin(() => transitions.apply(opportunity.id, 'lost', { reason: S.reason }));
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toMatchObject({ status: 'lost', changedFields: ['reason'] });
    expect(storedFor(h, h.entries[0]!)).toMatchObject({ before: null, after: { reason: S.reason } });
  });

  it('crm.opportunity.propagation_skip — the refusal sentence goes to the store', async () => {
    const h = harness();
    const opportunity = seedOpportunity(h.em);
    h.em.seed(CrmOpportunityLink, {
      opportunityId: opportunity.id,
      documentKind: 'order',
      documentId: ORDER,
      syncStatus: true,
    } as never);
    h.em.seed(CrmOrderStatusMapping, {
      direction: 'order_to_opportunity',
      orderStatusCode: 'cancelled',
      opportunityStatusCode: 'lost',
      requireAllOrders: false,
    } as never);
    const propagation = new OrderStatusPropagationService({ emFactory: () => h.em, commandBus: h.commandBus } as never);
    await asAdmin(() =>
      propagation.onOrderStatusChanged({ orderId: ORDER, organizationId: ORG, to: 'cancelled' }, async () => {
        throw new HttpError(409, ERROR_CODES.CRM_INVALID_TRANSITION, 'refused', { reason: S.reason });
      }),
    );
    expectNoAuditValues(h.entries, SENTINELS);
    const entry = h.entries.find((candidate) => candidate.action === 'crm.opportunity.propagation_skip');
    expect(entry?.stateAfter).toMatchObject({ outcome: 'skipped', changedFields: ['reason'] });
    expect(storedFor(h, entry!)).toMatchObject({ after: { reason: S.reason } });
  });

  describe('Events', () => {
    function events(h: ReturnType<typeof harness>) {
      return new OpportunityEventService({
        emFactory: () => h.em,
        commandBus: h.commandBus,
        adminUsers: { findByIds: async () => [] },
        workflowRead: { loadGraph: async () => ({ kindOf: () => 'open' }) },
        now: () => new Date('2026-11-01T00:00:00Z'),
      } as never);
    }

    it('crm.opportunity.event_add / event_update / event_remove — the name goes to the store', async () => {
      const h = harness();
      const opportunity = seedOpportunity(h.em);
      const service = events(h);
      const added = await asAdmin(() =>
        service.add(opportunity.id, {
          name: S.event,
          description: S.description,
          allDay: false,
          startsAt: '2026-12-01T10:00:00.000Z',
          endsAt: '2026-12-01T11:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        } as never),
      );
      await asAdmin(() => service.update(opportunity.id, added.id, { name: S.eventNew } as never));
      await asAdmin(() => service.remove(opportunity.id, added.id));

      expect(h.entries.map((entry) => entry.action)).toEqual([
        'crm.opportunity.event_add',
        'crm.opportunity.event_update',
        'crm.opportunity.event_remove',
      ]);
      expectNoAuditValues(h.entries, SENTINELS);
      const [add, update, remove] = h.entries;
      expect(storedFor(h, add!)).toMatchObject({ before: null, after: { eventName: S.event } });
      expect(storedFor(h, update!)).toMatchObject({ before: { eventName: S.event }, after: { eventName: S.eventNew } });
      expect(storedFor(h, remove!)).toMatchObject({ before: { eventName: S.eventNew }, after: null });
      expect(update?.stateAfter?.changedFields).toEqual(['eventName']);
    });
  });

  it('crm.opportunity.attachment_add / attachment_remove — the file name goes to the store', async () => {
    const h = harness();
    const opportunity = seedOpportunity(h.em);
    const asset = { id: ASSET, filename: S.file, mimeType: 'application/pdf', visibility: 'private', sizeBytes: '10' };
    const service = new OpportunityAttachmentService({
      emFactory: () => h.em,
      commandBus: h.commandBus,
      assets: {
        findById: async () => asset,
        findByIds: async () => [asset],
        visibleToCaller: async (ids: readonly string[]) => new Set(ids),
        resolveUrls: async (ids: readonly string[]) => new Map(ids.map((id) => [id, '/files/x'])),
      },
      assetsLibrary: {},
      adminUsers: { findByIds: async () => [] },
    } as never);
    const { attachment } = await asAdmin(() => service.add(opportunity.id, ASSET));
    await asAdmin(() => service.remove(opportunity.id, attachment.id));

    expectNoAuditValues(h.entries, SENTINELS);
    const [add, remove] = h.entries;
    expect(storedFor(h, add!)).toMatchObject({ before: null, after: { fileName: S.file } });
    expect(storedFor(h, remove!)).toMatchObject({ before: { fileName: S.file }, after: null });
  });

  it('the sentinel check itself catches a leak — a check that cannot fail proves nothing', () => {
    expect(() =>
      expectNoAuditValues(
        [{ action: 'x', objectType: 'crm_opportunity', objectId: 'id', stateAfter: { title: S.title } }],
        SENTINELS,
      ),
    ).toThrow(/stateAfter\.title/);
    expect(() => expectNoAuditValues([], SENTINELS)).toThrow(/no audit entry/);
  });

  it('records no key outside the allowlist across every Command above', async () => {
    // Re-runs the update — the Command with the widest state — and holds its keys.
    const h = harness();
    const opportunity = seedOpportunity(h.em);
    await asAdmin(() =>
      opportunityService(h).update(opportunity.id, { title: S.titleNew, manualValue: S.amountNew } as never, null),
    );
    const { CRM_AUDIT_KEYS } = await import('./opportunity-audit-state.js');
    expect(topLevelKeys(h.entries).filter((key) => !CRM_AUDIT_KEYS.has(key))).toEqual([]);
  });
});
