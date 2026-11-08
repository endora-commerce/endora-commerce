import { describe, expect, it } from 'vitest';
import type { AuthSessionPort } from '@endora-commerce/contracts';
import type { AuditPort, RecordAuditInput } from '@endora-commerce/platform/kernel';
import { MfaAdminEnforcementService } from './mfa-admin-enforcement.service.js';

/**
 * Issue #349 — when a role starts requiring a second factor, the sessions of
 * its holders who have none were opened without one and would last up to
 * thirty days. This port ends them: only the unenrolled, sparing the acting
 * administrator's own session, and answering how many were signed out.
 */
function harness(enrolled: readonly string[], canEnforce = true) {
  const destroyed: Array<[string, unknown]> = [];
  const invalidated: string[] = [];
  const audits: RecordAuditInput[] = [];
  const sessions = {
    destroyAllForAdmin: async (adminUserId: string, options?: unknown) => {
      destroyed.push([adminUserId, options]);
    },
  } as unknown as AuthSessionPort;
  const audit = {
    record: async (input: RecordAuditInput) => {
      audits.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const service = new MfaAdminEnforcementService({
    activeAdminIds: async (ids) => ids.filter((id) => enrolled.includes(id)),
    sessions,
    invalidatePending: async (id) => {
      invalidated.push(id);
    },
    auditLog: audit,
    canEnforce,
  });
  return { service, destroyed, invalidated, audits };
}

describe('MfaAdminEnforcementService', () => {
  it('ends the sessions and pending logins of the unenrolled only, and counts them', async () => {
    const { service, destroyed, invalidated, audits } = harness(['b']);
    const count = await service.endUnprotectedAdminSessions(['a', 'b', 'c'], {
      exceptSessionId: 's-actor',
      trigger: 'role_requirement_enabled',
      roleCode: 'accounting',
    });
    expect(count).toBe(2);
    expect(destroyed).toEqual([
      ['a', { exceptSessionId: 's-actor' }],
      ['c', { exceptSessionId: 's-actor' }],
    ]);
    expect(invalidated).toEqual(['a', 'c']);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'mfa.admin_sessions_ended_for_requirement',
      objectType: 'admin_role',
      objectId: 'accounting',
      stateAfter: { trigger: 'role_requirement_enabled', roleCode: 'accounting', count: 2 },
    });
  });

  it('touches nothing and records nothing when everybody is enrolled', async () => {
    const { service, destroyed, audits } = harness(['a']);
    const count = await service.endUnprotectedAdminSessions(['a'], {
      trigger: 'role_assigned',
      roleCode: 'accounting',
    });
    expect(count).toBe(0);
    expect(destroyed).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('passes no exception when no session is to be spared', async () => {
    const { service, destroyed } = harness([]);
    await service.endUnprotectedAdminSessions(['a'], { trigger: 'role_assigned', roleCode: 'x' });
    expect(destroyed).toEqual([['a', undefined]]);
  });

  it('counts the unenrolled without ending anything, for the preview', async () => {
    const { service, destroyed } = harness(['b']);
    expect(await service.countUnprotected(['a', 'b', 'c', 'a'])).toBe(2);
    expect(destroyed).toEqual([]);
  });

  it('answers whether a requirement set now can be met', async () => {
    expect(await harness([], true).service.canEnforceAdminSecondFactor()).toBe(true);
    expect(await harness([], false).service.canEnforceAdminSecondFactor()).toBe(false);
  });
});
