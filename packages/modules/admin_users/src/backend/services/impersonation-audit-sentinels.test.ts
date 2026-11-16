/**
 * The audit-state rule for impersonation (`specs/conventions/audit-state.md`,
 * D-288, issue #470). `impersonation.start` is recorded against a
 * `@CustomerScoped` customer account, so its entry names whether a reason was
 * given, its length and the id of the `admin_impersonation_reasons` row that
 * holds it — never the reason — and whether the start named an Organization,
 * never which one.
 *
 * The service runs against an in-memory EntityManager whose `transactional`
 * keeps what was created only when the callback resolves, and a recording
 * audit port. The database rollback is the integration suite's
 * (`backend/test/integration/admin_users/impersonation-reason-store.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuthSessionPort, CustomerAccountReadPort, CustomerAccountRecord } from '@endora-commerce/contracts';
import type { AuditPort, RecordAuditInput } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { ImpersonationReason } from '../entities/impersonation-reason.entity.js';
import { ADMIN_USERS_AUDIT_KEYS } from './impersonation-audit-state.js';
import { ImpersonationService } from './impersonation-service.js';

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const ORG = randomUUID();
const CUSTOMER = randomUUID();
const REASON = 'S470-DESC s470@example.test';
const SENTINELS = [ORG, 'S470-DESC', 's470@example.test'];

function harness(options: { failAudit?: boolean } = {}) {
  const committed: Array<Record<string, unknown>> = [];
  const entries: RecordAuditInput[] = [];
  const em = {
    findOne: async () => ({ id: ADMIN }),
    transactional: async <T>(fn: (tx: unknown) => Promise<T>) => {
      const created: Array<Record<string, unknown>> = [];
      const recorded: RecordAuditInput[] = [];
      const tx = {
        create: (entity: unknown, data: Record<string, unknown>) => {
          if (entity !== ImpersonationReason) throw new Error('created an entity it does not own');
          const row = Object.assign(new ImpersonationReason(), data);
          created.push(row as unknown as Record<string, unknown>);
          return row;
        },
      };
      pending = recorded;
      const result = await fn(tx);
      committed.push(...created);
      entries.push(...recorded);
      return result;
    },
  };
  let pending: RecordAuditInput[] = [];
  const audit = {
    record: vi.fn(async () => {
      throw new Error('impersonation.start must be recorded within the reason store transaction');
    }),
    recordWithin: (_tx: unknown, input: RecordAuditInput) => {
      if (options.failAudit) throw new Error('audit write failed');
      pending.push(structuredClone(input));
      return input as never;
    },
  } as unknown as AuditPort;
  const accounts = {
    findById: async (id: string) => (id === CUSTOMER ? account() : null),
    findInOrganization: async (id: string, organizationId: string) =>
      id === CUSTOMER && organizationId === ORG ? account() : null,
  } as unknown as CustomerAccountReadPort;
  const createSession = vi.fn(async () => ({
    session: { id: 'imp-1' },
    cookieValue: 'imp-1.raw',
    expiresAt: new Date('2026-11-16T12:00:00.000Z'),
  }));
  const service = new ImpersonationService(
    () => em as unknown as EntityManager,
    { createSession } as unknown as AuthSessionPort,
    accounts,
    audit,
  );
  const start = (input: { organizationId?: string | null; reason?: string }) =>
    service.start({ adminUserId: ADMIN, adminSessionCookieValue: 'admin.raw', customerAccountId: CUSTOMER, ...input });
  return { start, entries, committed, createSession };
}

function account(): CustomerAccountRecord {
  return { id: CUSTOMER, organizationId: ORG, email: 's470@example.test', deletedAt: null } as unknown as CustomerAccountRecord;
}

function expectKeysAllowlisted(entries: readonly RecordAuditInput[]): void {
  for (const entry of entries) {
    for (const state of [entry.stateBefore, entry.stateAfter]) {
      for (const key of Object.keys(state ?? {})) expect(ADMIN_USERS_AUDIT_KEYS, `${entry.action}: ${key}`).toContain(key);
    }
  }
}

describe('impersonation audit state carries names, never values (#470)', () => {
  it('an Organization-scoped start with a reason records its shape and the store row, never the reason or the Organization', async () => {
    const h = harness();
    await h.start({ organizationId: ORG, reason: REASON });

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => e.action)).toEqual(['impersonation.start']);
    expect(h.committed).toHaveLength(1);
    const stored = h.committed[0]!;
    expect(stored).toMatchObject({ customerAccountId: CUSTOMER, organizationId: ORG, actorAdminUserId: ADMIN, reason: REASON });
    expect(h.entries[0]?.stateBefore).toBeNull();
    expect(h.entries[0]?.stateAfter).toEqual({
      hasReason: true,
      reasonLength: REASON.length,
      organizationScoped: true,
      valueChangeId: stored['id'],
    });
    expect(h.createSession).toHaveBeenCalledTimes(1);
  });

  it('a start without a reason writes no store row and records hasReason: false', async () => {
    const h = harness();
    await h.start({ organizationId: null });

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.committed).toEqual([]);
    expect(h.entries[0]?.stateAfter).toEqual({ hasReason: false, organizationScoped: false });
  });

  it('a failed audit write leaves no store row and mints no session', async () => {
    const h = harness({ failAudit: true });
    await expect(h.start({ organizationId: ORG, reason: REASON })).rejects.toThrow('audit write failed');
    expect(h.committed).toEqual([]);
    expect(h.entries).toEqual([]);
    expect(h.createSession).not.toHaveBeenCalled();
  });
});
