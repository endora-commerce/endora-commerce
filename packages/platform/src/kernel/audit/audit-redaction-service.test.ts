import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AUDIT_ERASED_MARKER } from '@endora-commerce/contracts';
import type { AuditPort, RecordAuditInput } from '../ports/audit.js';
import {
  AUDIT_REDACTED_ACTION,
  AUDIT_REDACTION_MAX_IDS_PER_TARGET,
  type AuditRedactionInput,
} from '../ports/audit-redaction.js';
import { AuditRedactionService, buildRedactionUpdate } from './audit-redaction-service.js';

/**
 * Issue #844 — `AuditRedactionService`, the one non-append write on the audit
 * table, against an in-memory stand-in for `audit_log_entries`.
 *
 * The stand-in answers the four statements the service sends by their leading
 * words, so what is pinned here is the algorithm — the guards, the chunking, the
 * idempotence, the top-up pass, the marker rule and the IP / user-agent rule —
 * and the statement *count*. What the statements do to PostgreSQL is
 * `backend/test/integration/kernel/audit-redaction.test.ts`'s.
 */

const ERASED = AUDIT_ERASED_MARKER;
const SUBJECT = '5f0c7c3e-8a2b-4d1e-9f00-000000000844';
const ORG = '5f0c7c3e-8a2b-4d1e-9f00-0000000000a1';
const ANOTHER_CUSTOMER = '5f0c7c3e-8a2b-4d1e-9f00-0000000000ad';

interface Row {
  id: string;
  action: string;
  object_type: string;
  object_id: string;
  state_before: Record<string, unknown> | null;
  state_after: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  actor_customer_account_id: string | null;
}

function row(partial: Partial<Row> & Pick<Row, 'object_type' | 'object_id'>): Row {
  return {
    id: randomUUID(),
    action: 'customer_account.update_profile',
    state_before: { email: 'old@example.com' },
    state_after: { email: 'new@example.com', organizationId: ORG },
    ip_address: '203.0.113.7',
    user_agent: 'Mozilla/5.0',
    actor_customer_account_id: null,
    ...partial,
  };
}

/** The fake table, the statements it saw, and hooks to break or extend a run. */
function harness(initial: Row[]) {
  const rows = [...initial];
  const updates: unknown[][] = [];
  const recorded: RecordAuditInput[] = [];
  const hooks: { afterList?: ((calls: number) => void) | undefined; beforeUpdate?: ((n: number) => void) | undefined } = {};
  let listCalls = 0;

  const execute = vi.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    if (sql.startsWith('select "id" from')) {
      listCalls += 1;
      const [objectType, ...ids] = params as string[];
      const out = rows
        .filter((r) => r.object_type === objectType && ids.includes(r.object_id) && r.action !== AUDIT_REDACTED_ACTION)
        .map((r) => ({ id: r.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
      hooks.afterList?.(listCalls);
      return out;
    }
    if (sql.startsWith('select "id", "state_before"')) {
      const ids = params as string[];
      return rows
        .filter((r) => ids.includes(r.id) && r.action !== AUDIT_REDACTED_ACTION)
        .map((r) => structuredClone(r));
    }
    if (sql.startsWith('update "audit_log_entries"')) {
      hooks.beforeUpdate?.(updates.length + 1);
      updates.push(params);
      for (let i = 0; i < params.length; i += 5) {
        const [id, sb, sa, ip, ua] = params.slice(i, i + 5) as [string, string | null, string | null, string | null, string | null];
        const target = rows.find((r) => r.id === id)!;
        target.state_before = sb === null ? null : JSON.parse(sb);
        target.state_after = sa === null ? null : JSON.parse(sa);
        target.ip_address = ip;
        target.user_agent = ua;
      }
      return [];
    }
    if (sql.startsWith('select 1 from')) {
      const [objectType, objectId] = params as string[];
      return rows.some((r) => r.action === AUDIT_REDACTED_ACTION && r.object_type === objectType && r.object_id === objectId)
        ? [{ '?column?': 1 }]
        : [];
    }
    throw new Error(`unexpected statement: ${sql}`);
  });

  const tx = { execute } as unknown as EntityManager;
  const em = {
    execute,
    transactional: vi.fn(async <T>(work: (t: EntityManager) => Promise<T>): Promise<T> => work(tx)),
  } as unknown as EntityManager;

  const auditLog = {
    record: vi.fn(),
    query: vi.fn(),
    findByObjectIds: vi.fn(),
    recordWithin: vi.fn((_em: EntityManager, input: RecordAuditInput) => {
      recorded.push(input);
      rows.push(
        row({
          action: input.action,
          object_type: input.objectType,
          object_id: input.objectId,
          state_before: input.stateBefore ?? null,
          state_after: input.stateAfter ?? null,
          ip_address: null,
          user_agent: null,
        }),
      );
      return {} as never;
    }),
  } as unknown as AuditPort;

  const service = new AuditRedactionService(() => em, auditLog);
  return { rows, updates, recorded, hooks, execute, service, auditLog };
}

function input(overrides: Partial<AuditRedactionInput> = {}): AuditRedactionInput {
  return {
    reason: 'anonymization',
    subject: { objectType: 'customer_account', objectId: SUBJECT },
    subjectActorAccountId: SUBJECT,
    targets: [
      { objectType: 'customer_account', objectIds: [SUBJECT] },
      { objectType: 'organization', objectIds: [ORG], keepKeys: ['blockSource'] },
    ],
    ...overrides,
  };
}

describe('AuditRedactionService — guards', () => {
  it.each([
    ['no target', { targets: [] }],
    ['a target with no id', { targets: [{ objectType: 'organization', objectIds: [] }] }],
    ['an id that is not UUID-shaped', { targets: [{ objectType: 'organization', objectIds: ['org-1'] }] }],
    [
      'more ids in one target than the sanity limit',
      {
        targets: [
          { objectType: 'address', objectIds: Array.from({ length: AUDIT_REDACTION_MAX_IDS_PER_TARGET + 1 }, () => randomUUID()) },
        ],
      },
    ],
    ['a reason it does not know', { reason: 'cleanup' as never }],
    ['a subject that is not UUID-shaped', { subject: { objectType: 'customer_account' as const, objectId: 'x' } }],
    ['a subject of another type', { subject: { objectType: 'organization' as never, objectId: SUBJECT } }],
  ])('refuses %s, before touching the table', async (_label, overrides) => {
    const h = harness([]);
    await expect(h.service.redact(input(overrides as Partial<AuditRedactionInput>))).rejects.toThrow();
    expect(h.execute).not.toHaveBeenCalled();
  });
});

describe('AuditRedactionService — the rewrite', () => {
  it('rewrites every in-scope row and leaves the rest alone', async () => {
    const mine = row({ object_type: 'customer_account', object_id: SUBJECT });
    const org = row({ object_type: 'organization', object_id: ORG, state_after: { blockSource: 'staff', blockReason: 'Fraud' } });
    const other = row({ object_type: 'customer_account', object_id: randomUUID() });
    const order = row({ object_type: 'order', object_id: randomUUID(), actor_customer_account_id: SUBJECT });
    const h = harness([mine, org, other, order]);
    const otherBefore = structuredClone(other);
    const orderBefore = structuredClone(order);

    const result = await h.service.redact(input());

    expect(result).toEqual({ rowsInScope: 2, rowsChanged: 2, markerWritten: true });
    expect(h.rows.find((r) => r.id === mine.id)).toMatchObject({
      state_before: { email: ERASED },
      state_after: { email: ERASED, organizationId: ORG },
    });
    expect(h.rows.find((r) => r.id === org.id)!.state_after).toEqual({ blockSource: 'staff', blockReason: ERASED });
    expect(h.rows.find((r) => r.id === other.id)).toEqual(otherBefore);
    // The subject acted on its order: the order's own row is not in scope.
    expect(h.rows.find((r) => r.id === order.id)).toEqual(orderBefore);
  });

  it('erases the IP and user agent only on rows the subject acted on for itself', async () => {
    const self = row({ object_type: 'customer_account', object_id: SUBJECT, actor_customer_account_id: SUBJECT });
    const byOperator = row({ object_type: 'customer_account', object_id: SUBJECT, ip_address: '198.51.100.1' });
    const noIp = row({ object_type: 'organization', object_id: ORG, actor_customer_account_id: SUBJECT, ip_address: null, user_agent: null });
    const h = harness([self, byOperator, noIp]);

    await h.service.redact(input());

    expect(h.rows.find((r) => r.id === self.id)).toMatchObject({ ip_address: ERASED, user_agent: ERASED });
    expect(h.rows.find((r) => r.id === byOperator.id)).toMatchObject({ ip_address: '198.51.100.1', user_agent: 'Mozilla/5.0' });
    expect(h.rows.find((r) => r.id === noIp.id)).toMatchObject({ ip_address: null, user_agent: null });
  });

  it('keeps the IP and user agent when the caller names no acting account', async () => {
    const self = row({ object_type: 'customer_account', object_id: SUBJECT, actor_customer_account_id: SUBJECT });
    const h = harness([self]);

    await h.service.redact(input({ subjectActorAccountId: null }));

    expect(h.rows.find((r) => r.id === self.id)).toMatchObject({ ip_address: '203.0.113.7', user_agent: 'Mozilla/5.0' });
  });

  it('writes in chunks of 500, one statement each', async () => {
    const many = Array.from({ length: 1203 }, () => row({ object_type: 'customer_account', object_id: SUBJECT }));
    const h = harness(many);

    const result = await h.service.redact(input());

    expect(result).toMatchObject({ rowsInScope: 1203, rowsChanged: 1203 });
    expect(h.updates.map((params) => params.length / 5)).toEqual([500, 500, 203]);
    expect(h.rows.filter((r) => r.object_id === SUBJECT && r.action !== AUDIT_REDACTED_ACTION).every((r) => r.state_after?.['email'] === ERASED)).toBe(true);
  });

  it('skips a row that is already redacted, and a re-run writes nothing', async () => {
    const h = harness([
      row({ object_type: 'customer_account', object_id: SUBJECT }),
      row({ object_type: 'customer_account', object_id: SUBJECT, state_before: null, state_after: { anonymizedAt: '2026-11-07T10:00:00.000Z' } }),
    ]);

    expect(await h.service.redact(input())).toEqual({ rowsInScope: 2, rowsChanged: 1, markerWritten: true });
    expect(h.updates.map((params) => params.length / 5)).toEqual([1]);

    expect(await h.service.redact(input())).toEqual({ rowsInScope: 2, rowsChanged: 0, markerWritten: false });
    expect(h.updates).toHaveLength(1);
    expect(h.recorded).toHaveLength(1);
  });

  it('never selects, rewrites or counts an earlier audit.redacted row', async () => {
    const h = harness([row({ object_type: 'customer_account', object_id: SUBJECT })]);
    await h.service.redact(input());
    const marker = h.rows.find((r) => r.action === AUDIT_REDACTED_ACTION)!;
    const markerBefore = structuredClone(marker);

    const again = await h.service.redact(input());

    expect(again.rowsInScope).toBe(1);
    expect(h.rows.find((r) => r.id === marker.id)).toEqual(markerBefore);
  });

  it('catches a row written during the run in its top-up pass', async () => {
    const h = harness([row({ object_type: 'customer_account', object_id: SUBJECT })]);
    const late = row({ object_type: 'organization', object_id: ORG });
    h.hooks.afterList = (calls) => {
      // After the snapshot of the last target, before the top-up pass.
      if (calls === 2) h.rows.push(late);
    };

    const result = await h.service.redact(input());

    expect(result).toEqual({ rowsInScope: 2, rowsChanged: 2, markerWritten: true });
    expect(h.rows.find((r) => r.id === late.id)!.state_after).toMatchObject({ email: ERASED });
  });

  it('finishes an interrupted run on the next one, with one marker in all', async () => {
    const many = Array.from({ length: 1100 }, () => row({ object_type: 'customer_account', object_id: SUBJECT }));
    const h = harness(many);
    h.hooks.beforeUpdate = (n) => {
      if (n === 2) throw new Error('connection lost');
    };

    await expect(h.service.redact(input())).rejects.toThrow('connection lost');
    expect(h.recorded).toHaveLength(0);

    h.hooks.beforeUpdate = undefined;
    const result = await h.service.redact(input());

    expect(result).toEqual({ rowsInScope: 1100, rowsChanged: 600, markerWritten: true });
    expect(h.rows.filter((r) => r.action === AUDIT_REDACTED_ACTION)).toHaveLength(1);
    expect(h.rows.filter((r) => r.object_id === SUBJECT && r.action !== AUDIT_REDACTED_ACTION).every((r) => r.state_after?.['email'] === ERASED)).toBe(true);
  });
});

// Issue #959 — a subject with more than 1,000 addresses, in its personal
// organisation or in the retired personal book, is finished by one call: the
// ids are split into lookups of at most 1,000 inside it, and one marker row is
// written.
describe('AuditRedactionService — a target with more than 1,000 ids', () => {
  it.each([['address'], ['customer_address']])(
    'redacts 1,001 %s ids in one call, with one marker row',
    async (objectType) => {
      const ids = Array.from({ length: 1001 }, () => randomUUID());
      const h = harness(ids.map((id) => row({ object_type: objectType, object_id: id })));

      const result = await h.service.redact(
        input({
          targets: [
            { objectType: 'customer_account', objectIds: [SUBJECT] },
            { objectType, objectIds: ids },
          ],
        }),
      );

      expect(result).toEqual({ rowsInScope: 1001, rowsChanged: 1001, markerWritten: true });
      expect(h.rows.filter((r) => r.object_type === objectType).every((r) => r.state_after?.['email'] === ERASED)).toBe(true);
      expect(h.recorded).toHaveLength(1);
      expect(h.rows.filter((r) => r.action === AUDIT_REDACTED_ACTION)).toHaveLength(1);
      expect((h.recorded[0]!.stateAfter as { objectIds: Record<string, string[]> }).objectIds[objectType]).toEqual(ids);
      // No lookup names more than 1,000 ids.
      const lookups = h.execute.mock.calls.filter(([sql]) => sql.startsWith('select "id" from'));
      expect(Math.max(...lookups.map(([, params]) => (params as unknown[]).length - 1))).toBeLessThanOrEqual(1000);
    },
  );
});

describe('AuditRedactionService — the audit.redacted row', () => {
  it('writes one for a subject with no history at all, and none on a re-run', async () => {
    const h = harness([]);

    expect(await h.service.redact(input())).toEqual({ rowsInScope: 0, rowsChanged: 0, markerWritten: true });
    expect(await h.service.redact(input())).toEqual({ rowsInScope: 0, rowsChanged: 0, markerWritten: false });
    expect(h.recorded).toHaveLength(1);
  });

  it('writes one more when a later run finds something new to redact', async () => {
    const h = harness([row({ object_type: 'customer_account', object_id: SUBJECT })]);
    await h.service.redact(input());
    h.rows.push(row({ object_type: 'organization', object_id: ORG }));

    const result = await h.service.redact(input());

    expect(result).toMatchObject({ rowsChanged: 1, markerWritten: true });
    expect(h.recorded).toHaveLength(2);
  });

  it('is a system row about the subject holding counts and ids only', async () => {
    const h = harness([
      row({ object_type: 'customer_account', object_id: SUBJECT }),
      row({ object_type: 'organization', object_id: ORG }),
      row({ object_type: 'organization', object_id: ORG }),
    ]);

    await h.service.redact(input());

    expect(h.recorded).toEqual([
      {
        actorAdminUserId: null,
        action: AUDIT_REDACTED_ACTION,
        objectType: 'customer_account',
        objectId: SUBJECT,
        stateBefore: null,
        stateAfter: {
          reason: 'anonymization',
          rowsInScope: 3,
          rowsChanged: 3,
          byObjectType: { customer_account: 1, organization: 2 },
          objectIds: { customer_account: [SUBJECT], organization: [ORG] },
        },
      },
    ]);
    // Written on the run's own transactional manager, not on a fork of the port's.
    expect(h.auditLog.record).not.toHaveBeenCalled();
  });
});

describe('buildRedactionUpdate', () => {
  it('is one statement for a whole chunk, keyed by id', () => {
    const ids = [randomUUID(), randomUUID()];
    const { sql, params } = buildRedactionUpdate(
      ids.map((id) => ({ id, stateBefore: null, stateAfter: { a: ERASED }, ipAddress: ERASED, userAgent: null })),
    );
    expect(sql.match(/update /g)).toHaveLength(1);
    expect(sql).toContain('from (values');
    expect(params).toEqual([ids[0], null, '{"a":"[erased]"}', ERASED, null, ids[1], null, '{"a":"[erased]"}', ERASED, null]);
  });

  it('refuses an empty chunk', () => {
    expect(() => buildRedactionUpdate([])).toThrow();
  });
});

describe('AuditRedactionService — somebody else\'s IP', () => {
  it('leaves the IP of another customer who acted on the subject', async () => {
    const h = harness([row({ object_type: 'customer_account', object_id: SUBJECT, actor_customer_account_id: ANOTHER_CUSTOMER })]);
    await h.service.redact(input());
    expect(h.rows[0]).toMatchObject({ ip_address: '203.0.113.7' });
  });
});
