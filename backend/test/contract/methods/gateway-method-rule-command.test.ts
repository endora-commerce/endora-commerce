import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { PaymentMethod } from '../../helpers/package-entities.js';

/**
 * Issue #125 — `PUT /admin/<gateway>/methods/:id` runs as one Command.
 *
 * The handler used to write three things: the method's `status`, its rule row
 * (minimum amount + allowed countries) and its per-Organization deny list. Each
 * flushed on its own, with the audit entry appended at the end — so a failure
 * on the third write left the first two committed and recorded nothing at all.
 * Running the handler through `CommandBus.run` makes the remaining writes and
 * the audit row one transaction.
 *
 * **`status` is no longer one of them** (feature 076, D-82), and issue #198 is
 * what that cost. This file landed on the same day as the D-82 change; each
 * merge request was green on its own branch and the pair was red the moment
 * both were on `master`, because the assertions below still read
 * `stateBefore.status` out of an audit entry whose Command had stopped writing
 * the column. Availability is `payment_methods`' operation now, under its own
 * action name, and `status` was dropped from these request bodies — a client
 * that still sends one has it stripped by Zod. So the diff this Command records
 * is its own two tables, and the assertions follow it there:
 *
 *  - the audit row carries the rule state, before and after, and **no `status`
 *    key** — the seam D-82 drew, asserted from the side that must not cross it;
 *  - the method's availability is exactly as the fixture left it, because
 *    nothing on this path writes it;
 *  - and the rollback proof reads the **rule**, not the status column. It read
 *    the status column until issue #198: after D-82 nothing on this path could
 *    move it, so "unchanged" was true whether the transaction rolled back or
 *    not, and four tests were passing on a vacuous assertion.
 *
 * The unknown-Organization body is still the cheapest way to fail the last
 * write: the deny bridge carries a foreign key to `organizations`, so the
 * insert is refused by the database after the rule row has been assigned.
 *
 * Until D-163 each case also called `isRegisteredCommand(entries[0]!.action)`,
 * and the first case was named after it. The registry it read was read by
 * nothing else: `check:command-coverage` decides coverage syntactically from
 * `commandBus.run(` and has never imported it, and the tree's one undo
 * affordance reads the `reversible` **column** on
 * `catalog_bulk_operations`. The line is gone with the list, and nothing it
 * proved is lost — what proves the path is the exact single-row assertion above
 * it and the rollback proof below, which is a property only a Command's
 * transaction has.
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

/** The rule state a gateway's list route renders, which is what the Command writes. */
interface MethodRuleView {
  id: string;
  minOrderAmount: number;
  allowedCountries: string[];
  disabledOrganizationIds: string[];
}

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

  /** The persisted rule, read back the way the gateway's own screen reads it. */
  const ruleOf = async (module: string, id: string): Promise<MethodRuleView> => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/${module}/methods`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const { methods } = (res.json() as { data: { methods: MethodRuleView[] } }).data;
    const rule = methods.find((m) => m.id === id);
    expect(rule, `${module} does not list the method it was just asked to configure`).toBeDefined();
    return rule!;
  };

  for (const gateway of GATEWAYS) {
    it(`records ${gateway.action} as exactly one Command audit row`, async () => {
      const id = methodIds.get(gateway.module)!;

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/${gateway.module}/methods/${id}`,
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { minOrderAmount: 25, allowedCountries: ['PL'] },
      });
      expect(res.statusCode).toBe(200);

      const entries = await auditEntries(id);
      expect(entries.map((e) => e.action)).toEqual([gateway.action]);

      const entry = entries[0]!;
      const before = entry.stateBefore as Record<string, unknown> | null;
      const after = entry.stateAfter as Record<string, unknown> | null;
      expect(before?.['minOrderAmount']).toBe(0);
      expect(before?.['allowedCountries']).toEqual([]);
      expect(before?.['disabledOrganizationIds']).toEqual([]);
      expect(after?.['minOrderAmount']).toBe(25);
      expect(after?.['allowedCountries']).toEqual(['PL']);
      expect(after?.['disabledOrganizationIds']).toEqual([]);
      // D-82 — availability left this Command, so it must not reappear in its
      // diff on either side.
      expect(Object.keys(before ?? {})).not.toContain('status');
      expect(Object.keys(after ?? {})).not.toContain('status');
      // And the column itself is exactly where the fixture put it.
      expect(await statusOf(id)).toBe('inactive');
    });

    it(`rolls the ${gateway.module} rule back when the deny list is refused`, async () => {
      const id = methodIds.get(gateway.module)!;
      const ruleBefore = await ruleOf(gateway.module, id);
      const statusBefore = await statusOf(id);
      const entriesBefore = (await auditEntries(id)).length;

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/${gateway.module}/methods/${id}`,
        cookies: { b2b_session: 'stub-admin-session' },
        // A rule change that would stick if the transaction were per write,
        // plus an Organization id nothing in `organizations` matches: the deny
        // bridge's foreign key refuses it, after the rule row has been
        // assigned.
        payload: {
          minOrderAmount: 99,
          allowedCountries: ['DE'],
          disabledOrganizationIds: [randomUUID()],
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);

      const ruleAfter = await ruleOf(gateway.module, id);
      expect(ruleAfter.minOrderAmount).toBe(ruleBefore.minOrderAmount);
      expect(ruleAfter.allowedCountries).toEqual(ruleBefore.allowedCountries);
      expect(ruleAfter.disabledOrganizationIds).toEqual(ruleBefore.disabledOrganizationIds);
      expect(await statusOf(id)).toBe(statusBefore);
      expect((await auditEntries(id)).length).toBe(entriesBefore);
    });
  }
});
