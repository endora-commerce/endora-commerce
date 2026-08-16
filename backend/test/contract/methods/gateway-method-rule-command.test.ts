import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { isRegisteredCommand } from '../../../src/commands/command-registry.js';

/**
 * Issue #125 — `PUT /admin/<gateway>/methods/:id` runs as one Command.
 *
 * The handler writes three things: the method's `status`, its rule row
 * (minimum amount + allowed countries) and its per-Organization deny list. Each
 * used to flush on its own, with the audit entry appended at the end — so a
 * failure on the third write left the first two committed and recorded nothing
 * at all. The gateway an operator meant to switch on was switched on, the
 * restriction that was supposed to come with it was not, and the audit log said
 * neither had happened.
 *
 * Running the handler through `CommandBus.run` makes the three writes and the
 * audit row one transaction. The unknown-Organization body below is the cheapest
 * way to fail the last of the three: the deny bridge carries a foreign key to
 * `organizations`, so the insert is refused by the database after `status` has
 * been assigned.
 *
 * The four gateways are the same forty lines four times over; they are asserted
 * from one table so a reviewer who reads one file can trust the other three.
 * Autopay's `code` is not free — its handler configures only the hosted paywall
 * method — which is why the seed carries a code per gateway rather than one
 * pattern.
 */
const GATEWAYS = [
  { module: 'stripe', adapter: 'stripe', code: 'stripe_probe', action: 'stripe_payment_method.update' },
  { module: 'autopay', adapter: 'autopay', code: 'autopay_pbl', action: 'autopay_payment_method.update' },
  { module: 'payu', adapter: 'payu', code: 'payu_probe', action: 'payu_payment_method.update' },
  { module: 'tpay', adapter: 'tpay', code: 'tpay_probe', action: 'tpay_payment_method.update' },
] as const;

describe('gateway payment-method rules are written through the Command Bus (issue #125)', () => {
  let h: BackendServerHandle;
  const methodIds = new Map<string, string>();

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const gateway of GATEWAYS) {
      const method = em.create(PaymentMethod, {
        code: gateway.code,
        name: { default: `${gateway.module} probe` },
        kind: 'gateway',
        adapter: gateway.adapter,
        status: 'inactive',
        additionalPrice: '0',
        statusOnPending: 'new',
        statusOnSuccess: 'paid',
        statusOnFailure: 'cancelled',
      });
      em.persist(method);
      methodIds.set(gateway.module, method.id);
    }
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const statusOf = async (id: string): Promise<string | undefined> =>
    (await h.em().findOne(PaymentMethod, { id }))?.status;

  const auditEntries = async (id: string): Promise<AuditLogEntry[]> =>
    h.em().find(AuditLogEntry, { objectType: 'payment_method', objectId: id });

  for (const gateway of GATEWAYS) {
    it(`records ${gateway.action} as a registered Command action`, async () => {
      const id = methodIds.get(gateway.module)!;

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/${gateway.module}/methods/${id}`,
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { status: 'active', minOrderAmount: 25, allowedCountries: ['PL'] },
      });
      expect(res.statusCode).toBe(200);

      const entries = await auditEntries(id);
      expect(entries.map((e) => e.action)).toEqual([gateway.action]);
      expect(isRegisteredCommand(entries[0]!.action)).toBe(true);

      const entry = entries[0]!;
      expect((entry.stateBefore as { status?: string } | null)?.status).toBe('inactive');
      expect((entry.stateAfter as { status?: string } | null)?.status).toBe('active');
      expect((entry.stateAfter as { minOrderAmount?: number } | null)?.minOrderAmount).toBe(25);
      expect((entry.stateAfter as { allowedCountries?: string[] } | null)?.allowedCountries).toEqual(
        ['PL'],
      );
    });

    it(`rolls the ${gateway.module} status back when the deny list is refused`, async () => {
      const id = methodIds.get(gateway.module)!;
      const statusBefore = await statusOf(id);
      const entriesBefore = (await auditEntries(id)).length;

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/${gateway.module}/methods/${id}`,
        cookies: { b2b_session: 'stub-admin-session' },
        // An Organization id nothing in `organizations` matches: the deny
        // bridge's foreign key refuses it, after `status` has been assigned.
        payload: { status: 'inactive', disabledOrganizationIds: [randomUUID()] },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);

      expect(await statusOf(id)).toBe(statusBefore);
      expect((await auditEntries(id)).length).toBe(entriesBefore);
    });
  }
});
