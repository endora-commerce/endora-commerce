import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1468 (SALES-01, DEC-07) — `PATCH /api/v1/admin/organizations/:id` refuses `status`.
 *
 * The PATCH used to assign the status directly: no state-machine check (`rejected → active`
 * passed), no `approvedAt` / `blockedAt` / `blockedReason`, no `organization.status_changed.v1`,
 * no customer e-mail. Moderation (`…/approve`, `…/reject`, `…/block`, `…/unblock`) is the one
 * path that does all of them, so the PATCH now answers the platform's body-validation refusal
 * with the issue at `status` — and writes nothing: no column, no version, no audit entry, no
 * event. A refusal rather than a silent strip, because a strip would answer `200` to an
 * integrator who believes they blocked an organization.
 *
 * `vatStatus` stays writable through the PATCH (owner ruling OQ-1 = B: the screen's
 * "Change VAT status…" dialog sends exactly that).
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('PATCH /api/v1/admin/organizations/:id — status is moderation-only (#1468)', () => {
  let h: BackendServerHandle;
  let orgId: string;
  const stamp = randomUUID().replace(/-/g, '').replace(/[a-f]/g, '7').slice(0, 9);
  let seq = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    const em = h.em();
    const org = em.create(Organization, {
      name: `Status refused ${stamp}`,
      taxId: `PL1468${stamp}${(seq++).toString().padStart(2, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Moderacji 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    });
    await em.persistAndFlush(org);
    orgId = org.id;
  });

  const patch = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/admin/organizations/${orgId}`, ...ADMIN, payload });

  const storedRow = async (): Promise<Organization> => {
    h.em().clear();
    return h.em().findOneOrFail(Organization, { id: orgId }, { filters: false });
  };

  const auditEntries = async () => {
    h.em().clear();
    return h.em().find(AuditLogEntry, { action: 'organization.admin_patch', objectId: orgId });
  };

  it('refuses status with the issue at status, and writes nothing', async () => {
    const before = await storedRow();
    const emit = vi.spyOn(h.eventBus, 'emit');
    try {
      const res = await patch({ status: 'blocked' });
      expect(res.statusCode, res.body).toBe(400);
      const error = (res.json() as { error: { code: string; details: Array<{ path: string; issue: string }> } }).error;
      expect(error.details.map((detail) => detail.path)).toEqual(['status']);
      expect(error.details[0]?.issue).toMatch(/approve, reject, block or unblock/);
      expect(emit.mock.calls.map(([event]) => event)).not.toContain('organization.status_changed.v1');
    } finally {
      emit.mockRestore();
    }

    const after = await storedRow();
    expect(after.status).toBe('active');
    expect(after.version).toBe(before.version);
    expect(after.updatedAt?.toISOString()).toBe(before.updatedAt?.toISOString());
    expect(after.blockedAt ?? null).toBeNull();
    expect(await auditEntries()).toEqual([]);
  });

  it('refuses the whole body when status travels with other fields', async () => {
    const res = await patch({ status: 'blocked', orderConfirmationEmails: ['ops@example.com'] });
    expect(res.statusCode, res.body).toBe(400);
    const after = await storedRow();
    expect(after.status).toBe('active');
    expect(after.orderConfirmationEmails ?? []).toEqual([]);
    expect(await auditEntries()).toEqual([]);
  });

  it('still accepts vatStatus alone, as the "Change VAT status…" dialog sends it', async () => {
    const before = await storedRow();
    const res = await patch({ vatStatus: 'reverse_charge', expectedUpdatedAt: before.updatedAt?.toISOString() });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { vatStatus: string; status: string } }).data).toMatchObject({
      vatStatus: 'reverse_charge',
      status: 'active',
    });
    const entries = await auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.stateBefore).toMatchObject({ status: 'active', vatStatus: 'vat_payer' });
    expect(entries[0]?.stateAfter).toMatchObject({ status: 'active', vatStatus: 'reverse_charge', changedFields: ['vatStatus'] });
  });
});
