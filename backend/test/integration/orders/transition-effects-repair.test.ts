import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CreditLimit, PaymentMethod } from '../../helpers/package-entities.js';
import { transitionEffectsRepair } from '../../../../packages/modules/orders/dist/backend/cli/transition-effects-repair.js';

/**
 * `orders transition-effects-repair` (`specs/142-order-transition-atomicity/`,
 * User Story 3, FR-016–FR-018, SC-003).
 *
 * The stranded orders are made the way the old code made them: a real order,
 * placed through the storefront so that it really holds stock and credit, whose
 * status is then moved **by writing the row directly** — a committed status
 * with no record of what it owes, which is exactly what a failed or refused
 * release used to leave behind.
 *
 * The command body is driven as the host drives it: with a `ModuleContext`
 * whose cradle is the composed container's, and with **no ambient tenant
 * context** — the body has to establish its own, or the Command Bus refuses the
 * applied write.
 */

const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

describe('orders transition-effects-repair (spec 142, US3)', () => {
  let h: BackendServerHandle;
  let creditMethodId: string;
  let plainMethodId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await em.execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
      SEED_PRODUCT_101_ID,
    ]);
    const method = (kind: 'credit_limit' | 'bank_transfer') =>
      em.create(PaymentMethod, {
        code: `${kind === 'credit_limit' ? 'cl' : 'bt'}_${randomUUID().slice(0, 8)}`,
        name: { default: kind },
        kind,
        adapter: kind,
        status: 'active',
        statusOnPending: 'new',
        statusOnSuccess: 'paid',
        statusOnFailure: 'on_hold',
      });
    const credit = method('credit_limit');
    const plain = method('bank_transfer');
    em.create(CreditLimit, {
      organizationId: TEST_ORGANIZATION_ID,
      grantedAmount: '1000000.00',
      currency: 'PLN',
    });
    await em.flush();
    creditMethodId = credit.id;
    plainMethodId = plain.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // --- fixtures --------------------------------------------------------------

  const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await h.em().getConnection().execute(sql, params)) as T[];

  async function place(kind: 'credit' | 'plain', quantity = 1): Promise<string> {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity },
      ...BUYER,
    });
    expect(add.statusCode).toBe(200);
    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: kind === 'credit' ? creditMethodId : plainMethodId,
      },
      ...BUYER,
    });
    expect(placed.statusCode, placed.body).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  /** A committed status with no record of what it owes — the old code's leftovers. */
  const strand = (orderId: string, column: 'status' | 'payment_status', value: string) =>
    rows(`update "orders" set "${column}" = ? where "id" = ?`, [value, orderId]);

  const heldAllocations = async (orderId: string): Promise<number> =>
    (
      await rows<{ count: number }>(
        `select count(*)::int as "count" from "stock_allocations" a
           join "order_items" oi on oi."id" = a."order_item_id"
          where oi."order_id" = ? and a."released_at" is null`,
        [orderId],
      )
    )[0]!.count;

  const reservation = async (orderId: string): Promise<string | null> =>
    (
      await rows<{ status: string }>(
        `select "status" from "credit_limit_reservations" where "order_id" = ?`,
        [orderId],
      )
    )[0]?.status ?? null;

  const effectRows = async (): Promise<number> =>
    (await rows<{ count: number }>(`select count(*)::int as "count" from "order_transition_effects"`))[0]!
      .count;

  const repairAudits = async (): Promise<Array<{ stateAfter: unknown; actorAdminUserId: unknown }>> =>
    (await h.auditLogService.query({ action: 'order.transition_effects_repair' })) as never;

  /** The command, as the host runs it: the composed cradle, and no tenant context. */
  async function repair(...argv: string[]): Promise<{ exit: number; out: string[] }> {
    const out: string[] = [];
    const ctx = { cradle: () => h.container.cradle } as unknown as ModuleContext;
    const exit = await transitionEffectsRepair({
      ctx,
      argv,
      out: (line) => out.push(line),
      err: (line) => out.push(line),
    });
    return { exit, out };
  }

  const summaryOf = (out: string[]): string => out.find((line) => line.includes('examined='))!;

  // --- the scenarios ----------------------------------------------------------

  it('reports zero and writes nothing when nothing is stranded (scenario 4)', async () => {
    // A live cancellation: it has its rows, so it is the mechanism's, not the repair's.
    const healthy = await place('credit');
    const cancelled = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${healthy}/status`,
      payload: { to: 'cancelled' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(cancelled.statusCode).toBe(200);
    const before = await effectRows();

    const dry = await repair();
    const applied = await repair('--apply');

    expect(dry.exit).toBe(0);
    expect(summaryOf(dry.out)).toContain('stranded=0');
    expect(summaryOf(applied.out)).toContain('stranded=0 recorded=0');
    expect(await effectRows()).toBe(before);
    expect(await repairAudits()).toHaveLength(0);
  });

  it('lists what each stranded order holds without writing, releases it with --apply, and finds nothing the second time (scenarios 1, 2; SC-003)', async () => {
    const cancelledOnCredit = await place('credit', 2);
    const cancelledPlain = await place('plain', 3);
    const paidOnCredit = await place('credit');
    // Cancelled long ago and holding nothing: a candidate, never a finding.
    const cancelledAndClean = await place('plain');
    await strand(cancelledOnCredit, 'status', 'cancelled');
    await strand(cancelledPlain, 'status', 'cancelled');
    await strand(paidOnCredit, 'payment_status', 'paid');
    await strand(cancelledAndClean, 'status', 'cancelled');
    await rows(
      `update "stock_allocations" set "released_at" = now()
        where "order_item_id" in (select "id" from "order_items" where "order_id" = ?)`,
      [cancelledAndClean],
    );
    const rowsBefore = await effectRows();

    // --- dry run: the list, and nothing else -------------------------------
    const dry = await repair();

    expect(dry.exit).toBe(0);
    expect(summaryOf(dry.out)).toContain('stranded=3');
    const lineFor = (orderId: string): string | undefined =>
      dry.out.find((line) => line.includes(orderId));
    expect(lineFor(cancelledOnCredit)).toMatch(/stock: 2 unit\(s\) in 1 allocation\(s\); credit: \d+\.\d{2} PLN/);
    expect(lineFor(cancelledPlain)).toMatch(/stock: 3 unit\(s\) in 1 allocation\(s\)$/);
    expect(lineFor(paidOnCredit)).toMatch(/holds credit: \d+\.\d{2} PLN$/);
    expect(lineFor(cancelledAndClean)).toBeUndefined();
    expect(dry.out.some((line) => line.includes('dry run: nothing was written'))).toBe(true);

    expect(await effectRows()).toBe(rowsBefore);
    expect(await heldAllocations(cancelledOnCredit)).toBe(1);
    expect(await reservation(cancelledOnCredit)).toBe('active');
    expect(await repairAudits()).toHaveLength(0);

    // --- applied: released through the follow-up mechanism, and audited ----
    const applied = await repair('--apply');

    expect(applied.exit).toBe(0);
    expect(summaryOf(applied.out)).toContain('stranded=3 recorded=4 released=4 waiting=0 failed=0');
    expect(await heldAllocations(cancelledOnCredit)).toBe(0);
    expect(await reservation(cancelledOnCredit)).toBe('released');
    expect(await heldAllocations(cancelledPlain)).toBe(0);
    expect(await reservation(paidOnCredit)).toBe('released');
    // An order that is only paid keeps its stock: it is not cancelled.
    expect(await heldAllocations(paidOnCredit)).toBe(1);

    const written = await rows<{ order_id: string; effect: string; reason: string; origin: string }>(
      `select "order_id", "effect", "reason", "origin" from "order_transition_effects"
        where "origin" = 'repair' order by "effect", "reason"`,
    );
    expect(written.map((r) => [r.effect, r.reason])).toEqual([
      ['credit.release', 'invoice_paid'],
      ['credit.release', 'order_cancelled'],
      ['stock.release', 'order_cancelled'],
      ['stock.release', 'order_cancelled'],
    ]);

    const audits = await repairAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorAdminUserId ?? null).toBeNull();
    expect(audits[0]!.stateAfter).toMatchObject({ recorded: 4 });

    // --- a second run finds nothing and writes nothing ----------------------
    const again = await repair('--apply');
    expect(summaryOf(again.out)).toContain('stranded=0 recorded=0');
    expect(await repairAudits()).toHaveLength(1);
    expect(summaryOf((await repair()).out)).toContain('stranded=0');
  });

  it('says a switched-off module`s holdings were not examined, and repairs the rest (scenario 3)', async () => {
    const orderId = await place('credit');
    await strand(orderId, 'status', 'cancelled');

    await withModuleOff('credit_limits', 'deactivated', async () => {
      const applied = await repair('--apply');

      expect(applied.exit).toBe(0);
      expect(
        applied.out.some(
          (line) => line.includes(`'credit_limits' is switched off`) && line.includes('NOT examined'),
        ),
      ).toBe(true);
      expect(summaryOf(applied.out)).toContain('stranded=1 recorded=1 released=1');
      expect(await heldAllocations(orderId)).toBe(0);
      // Nothing of the absent owner's was read or written.
      expect(await reservation(orderId)).toBe('active');
    });

    // The module is back: the credit half is found and released.
    const after = await repair('--apply');
    expect(summaryOf(after.out)).toContain('stranded=1 recorded=1 released=1');
    expect(await reservation(orderId)).toBe('released');
  });

  it('with both owners off it examines nothing and still exits successfully', async () => {
    const orderId = await place('plain');
    await strand(orderId, 'status', 'cancelled');

    const report = await withModulesDeactivated(['inventory', 'credit_limits'], () =>
      repair('--apply'),
    );

    expect(report.exit).toBe(0);
    expect(report.out.filter((line) => line.includes('NOT examined'))).toHaveLength(2);
    expect(summaryOf(report.out)).toContain('examined=0 stranded=0');
    expect(await heldAllocations(orderId)).toBe(1);

    // Left for the next run rather than lost.
    expect(summaryOf((await repair('--apply')).out)).toContain('released=1');
    expect(await heldAllocations(orderId)).toBe(0);
  });
});
