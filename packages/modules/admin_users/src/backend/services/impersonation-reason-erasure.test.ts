/**
 * Issue #470 — the impersonation reasons written about a customer account are
 * erased when the account is anonymised. Until the reason left the audit log,
 * the anonymisation's audit redaction (#844) erased it with the
 * `impersonation.start` entry; the reason store has to follow it.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort, RecordAuditInput } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { ImpersonationReason } from '../entities/impersonation-reason.entity.js';
import { ADMIN_USERS_AUDIT_KEYS } from './impersonation-audit-state.js';
import { eraseImpersonationReasons } from './impersonation-reason-erasure.js';

const CUSTOMER = randomUUID();

function harness(rows: number) {
  const deletes: Array<{ entity: unknown; where: unknown }> = [];
  const entries: RecordAuditInput[] = [];
  const tx = {
    nativeDelete: async (entity: unknown, where: unknown) => {
      deletes.push({ entity, where });
      return rows;
    },
  };
  const em = { transactional: async <T>(fn: (scoped: unknown) => Promise<T>) => fn(tx) } as unknown as EntityManager;
  const audit = {
    recordWithin: (_tx: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
  } as unknown as AuditPort;
  return { em, audit, deletes, entries };
}

describe('eraseImpersonationReasons (#470)', () => {
  it('deletes the account\'s reason rows and audits the count against the account', async () => {
    const h = harness(2);
    await expect(eraseImpersonationReasons(() => h.em, h.audit, CUSTOMER)).resolves.toBe(2);
    expect(h.deletes).toEqual([{ entity: ImpersonationReason, where: { customerAccountId: CUSTOMER } }]);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'impersonation.reasons_erase',
      objectType: 'customer_account',
      objectId: CUSTOMER,
      stateBefore: null,
      stateAfter: { deleted: 2 },
    });
    expectNoAuditValues(h.entries, ['S470-DESC']);
    for (const key of Object.keys(h.entries[0]!.stateAfter ?? {})) expect(ADMIN_USERS_AUDIT_KEYS).toContain(key);
  });

  it('writes no audit entry when the account has no reason rows', async () => {
    const h = harness(0);
    await expect(eraseImpersonationReasons(() => h.em, h.audit, CUSTOMER)).resolves.toBe(0);
    expect(h.entries).toEqual([]);
  });
});
