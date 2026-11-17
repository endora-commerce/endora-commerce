import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_ACCOUNT_ANONYMIZED_EVENT, type OrderReturnContextPort } from '@endora-commerce/contracts';
import { RETURNS_SETTING_CODES } from '@endora-commerce/mod-returns';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import { OrderItem, Product, ReturnCase, ReturnCaseAttachment } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { checkOutBasket, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';
import { buyerChannelIds, createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { makeMember, makeOrganization, releaseMembers, type ReturnsFixtureMember } from './organization-fixtures.js';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  runReturnsMaintenanceJob,
  type ReturnsMaintenanceJobDeps,
} from '../../../../packages/modules/returns/src/backend/workers/returns-maintenance-worker.js';
import { SMALL_PDF, allowOffPlatform, complaintReasonId, file, noOrderBody, upload } from './off-platform-fixtures.js';
import {
  captureReturnsNotificationJobs,
  processReturnsNotification,
  type CapturedReturnsJob,
} from './notification-jobs.js';

/**
 * `returns` off-state — Constitution XVII item 6.
 *
 * The module's prior off-state coverage is
 * `_admin_surfaces/batch-eight-palette-off-state.test.ts`, which asserts the
 * two palette actions go when the module does. That is feature 091's question;
 * item 6's are here, and the palette assertion is not repeated.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the admin RMA list and the return-status catalogue.
 *    The second is named separately because it answers from a workflow
 *    definition rather than from stored RMAs, and a workflow that keeps
 *    answering while its module is off is the module still being observable;
 *  * **storefront absence** — two buyer-facing routes, and they are different
 *    questions. `GET /api/v1/returns/reasons` is what the shop's return form
 *    is built from, and it answers to an anonymous caller: a switched-off
 *    returns module that still serves it invites a buyer into a flow that
 *    cannot complete. `GET /api/v1/returns` is the signed-in buyer's own RMA
 *    list;
 *  * **non-editable configuration** — the free-return window in days, an
 *    ordinary setting. `returns.enabled` is deliberately *not* the code
 *    written here: it is the module's activation control, the single exception
 *    item 6 names;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: RMAs, their comments, their settlements and the reason
 *    catalogue all stay, and the restored probes hold the routes to it.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: a shop that handles
 * returns by telephone switches this off from `/platform/modules` while the
 * deployment still offers it.
 */
describe('returns off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const channel = { 'x-sales-channel': 'default' };
  /** A case id that names nothing: restored, the consent routes answer `404`, which is not absence. */
  const ABSENT_CASE_ID = '00000000-0000-4000-8000-000000000905';

  const jobs: CapturedReturnsJob[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({ moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'returns', {
      routes: [
        { url: '/api/v1/admin/returns', cookies: admin },
        { url: '/api/v1/admin/returns/statuses', cookies: admin },
        { url: '/api/v1/returns/reasons', headers: channel },
        { url: '/api/v1/returns', headers: channel },
        // Issue #905 — the consent Commands go with the module, on both axes:
        // while it is off no consent is recorded or revoked.
        {
          method: 'POST',
          url: `/api/v1/admin/returns/${ABSENT_CASE_ID}/alternative-consent`,
          cookies: admin,
          payload: { resolution: 'credit', consentGivenAt: '2026-11-08T10:00:00.000Z', note: 'off-state probe' },
        },
        { method: 'DELETE', url: `/api/v1/admin/returns/${ABSENT_CASE_ID}/alternative-consent`, cookies: admin },
        // `specs/180-off-platform-complaints/` T038 — the writes that produce a
        // notification job, and the recipients health read, go with the module.
        {
          method: 'PATCH',
          url: '/api/v1/admin/returns/statuses/received',
          cookies: admin,
          payload: { notifyCustomerOnEntry: false },
        },
        {
          method: 'POST',
          url: `/api/v1/admin/returns/${ABSENT_CASE_ID}/comments`,
          cookies: admin,
          payload: { body: 'off-state probe', isCustomerVisible: true, notifyCustomer: true },
        },
        { url: '/api/v1/admin/returns/notification-health', cookies: admin },
        // `specs/180-off-platform-complaints/` T097 — phase B's customer routes (the form
        // configuration, the uploads, the add-a-file route and the file stream), the admin
        // file stream and the clause administration go with the module, on both axes.
        { url: '/api/v1/returns/form-config', headers: channel, cookies: CUSTOMER_COOKIE },
        { method: 'POST', url: '/api/v1/returns/uploads', headers: channel, cookies: CUSTOMER_COOKIE, payload: {} },
        {
          method: 'POST',
          url: `/api/v1/returns/${ABSENT_CASE_ID}/attachments`,
          headers: channel,
          cookies: CUSTOMER_COOKIE,
          payload: {},
        },
        { url: `/api/v1/returns/${ABSENT_CASE_ID}/attachments/${ABSENT_CASE_ID}/file`, headers: channel, cookies: CUSTOMER_COOKIE },
        { url: `/api/v1/admin/returns/${ABSENT_CASE_ID}/attachments/${ABSENT_CASE_ID}/file`, cookies: admin },
        { url: '/api/v1/admin/returns/clauses', cookies: admin },
        {
          method: 'POST',
          url: '/api/v1/admin/returns/clauses',
          cookies: admin,
          payload: { label: {}, text: {} },
        },
        { method: 'PATCH', url: `/api/v1/admin/returns/clauses/${ABSENT_CASE_ID}`, cookies: admin, payload: { weight: 1 } },
        { method: 'DELETE', url: `/api/v1/admin/returns/clauses/${ABSENT_CASE_ID}`, cookies: admin },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: RETURNS_SETTING_CODES.FREE_RETURN_DAYS,
        value: 7,
        cookies: admin,
      },
    });
  });
  /**
   * `specs/180-off-platform-complaints/` T038 (Principle XVII, research R-2): while
   * `returns` is off no `returns-notifications` job is produced — the routes that
   * produce one are absent — and none is consumed: the processor refuses with
   * `ModuleDisabledError`, so BullMQ keeps the job for when the module is back. Back
   * on, the same job is processed.
   */
  it.each(['deactivated', 'platform-unavailable'] as const)(
    'produces and consumes no notification job while %s, and processes it once restored',
    async (axis) => {
      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      const reasonId = await anyReasonId(h.em());
      const filed = await h.app.inject({
        method: 'POST',
        url: '/api/v1/returns',
        cookies: CUSTOMER_COOKIE,
        headers: channel,
        payload: { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
      });
      expect(filed.statusCode, filed.body).toBe(201);
      const caseId = (filed.json() as { data: { id: string } }).data.id;
      const job = jobs.find((j) => j.kind === 'case_submitted' && j.returnCaseId === caseId)!;
      expect(job).toBeTruthy();

      await withModuleOff('returns', axis, async () => {
        const before = jobs.length;
        const comment = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/returns/${caseId}/comments`,
          cookies: admin,
          payload: { body: 'while off', isCustomerVisible: true, notifyCustomer: true },
        });
        expect(comment.statusCode).not.toBe(201);
        expect(jobs.length).toBe(before);
        await expect(processReturnsNotification(h, job)).rejects.toBeInstanceOf(ModuleDisabledError);
      });

      await expect(processReturnsNotification(h, job)).resolves.toMatchObject({ messages: expect.any(Array) });
    },
  );

  /**
   * `specs/180-off-platform-complaints/` T097 (Principle XVII, research R-15): while
   * `returns` is off, an anonymisation erases nothing — the subscriber is not there —
   * and the maintenance clock does nothing, neither the erasure nor the upload sweep.
   * Restored, one maintenance pass catches both up.
   */
  describe('the erasure subscriber and the maintenance clock (180 T097)', () => {
    let undoStore: () => Promise<void>;
    let undoOffPlatform: () => Promise<void>;
    let organizationId: string;
    let reasonId: string;

    beforeAll(async () => {
      undoStore = (await useTemporaryAssetStore(h)).undo;
      undoOffPlatform = await allowOffPlatform(h);
      organizationId = await makeOrganization(h.em(), '180 off-state erasure');
      reasonId = await complaintReasonId(h.em());
    });
    afterAll(async () => {
      await undoOffPlatform();
      await undoStore();
      releaseMembers();
    });

    const pdf = { type: 'proof_of_purchase', filename: 'receipt.pdf', mime: 'application/pdf', value: SMALL_PDF };
    const erasedAt = async (caseId: string): Promise<Date | null> =>
      (await h.em().fork().findOneOrFail(ReturnCase, { id: caseId }, { filters: false })).personalDataErasedAt ?? null;
    const uploadExists = async (id: string): Promise<boolean> =>
      (await h.em().fork().count(ReturnCaseAttachment, { id }, { filters: false })) === 1;

    it.each(['deactivated', 'platform-unavailable'] as const)(
      'erases and sweeps nothing while %s, and catches up in the first pass once restored',
      async (axis) => {
        const member = await makeMember(h.em(), organizationId, 'member', { label: `Off180${axis}` });
        const cookies = { b2b_session: member.cookie };
        const filed = await file(h, noOrderBody(reasonId), { cookies, headers: channel });
        expect(filed.statusCode, filed.body).toBe(201);
        const caseId = (filed.json() as { data: { id: string } }).data.id;
        const expired = ((await upload(h, pdf, { cookies })).json() as { data: { uploadId: string } }).data.uploadId;
        await h.em().fork().nativeUpdate(ReturnCaseAttachment, { id: expired }, { expiresAt: new Date(Date.now() - 1000) });
        const deps = h.container.resolve('returnsMaintenanceDeps') as ReturnsMaintenanceJobDeps;

        await withModuleOff('returns', axis, async () => {
          await h.em().getConnection().execute(`update "customer_accounts" set "anonymized_at" = now() where "id" = ?`, [member.id]);
          h.eventBus.emit(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT, {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            customerAccountId: member.id,
            organizationId,
          } as never);
          await runWithoutTenantContext(() => runReturnsMaintenanceJob(deps, new Date()));
          // Give a subscriber that should not exist the time to show itself.
          await new Promise((resolve) => setTimeout(resolve, 200));
          expect(await erasedAt(caseId)).toBeNull();
          expect(await uploadExists(expired)).toBe(true);
        });

        await runWithoutTenantContext(() => runReturnsMaintenanceJob(deps, new Date()));
        await vi.waitFor(async () => expect(await erasedAt(caseId)).toBeInstanceOf(Date), { timeout: 5000 });
        expect(await uploadExists(expired)).toBe(false);
      },
    );
  });

  /**
   * Feature 155, Phase 12 (T092; FR-016a, spec edge case *Module activation*,
   * `contracts/returns-api.md` §4). `orders` records `returnable_at_purchase`
   * at placement whether `returns` is on or off — it has no edge to `returns`
   * — so an order placed while `returns` is off answers from its own stamp
   * once `returns` is switched back on: the endpoint's per-line `returnable` is
   * derived from it (`returns`' policy, Phase 12a, T096), and the port reports
   * the stamp it reads.
   */
  it('records returnable_at_purchase while returns is off, and answers from it once it is back on', async () => {
    const em = h.em();
    const RUN = minimumFixtureRun();
    const channels = await buyerChannelIds(em);
    const R = await createMinimumProduct(em, {
      sku: `ROFF-R-${RUN}`,
      nameEn: `Returnable ${RUN}`,
      namePl: `Zwrotny ${RUN}`,
      returnable: true,
      channelIds: channels,
    });
    const N = await createMinimumProduct(em, {
      sku: `ROFF-N-${RUN}`,
      nameEn: `Final ${RUN}`,
      namePl: `Bezzwrotny ${RUN}`,
      returnable: false,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: { $in: [R.id, N.id] } }, { manageStock: false });
    await em
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

    const orderId = await withModuleOff('returns', 'deactivated', async () => {
      await cartWritePortOf(h).replaceItemsForCustomer(
        {
          customerAccountId: TEST_CUSTOMER_ID,
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: await systemDefaultSalesChannelId(h.em()),
        },
        [
          { productId: R.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
          { productId: N.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
        ],
      );
      const placed = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
      const lookup = h.em();
      lookup.clear();
      const items = await lookup.find(OrderItem, { orderId: placed.id }, { filters: false });
      expect(Object.fromEntries(items.map((i) => [i.productId, i.returnableAtPurchase]))).toEqual({
        [R.id]: true,
        [N.id]: false,
      });
      return placed.id;
    });

    // Back on: the endpoint answers the order, and the port it reads reports
    // the stamp recorded while `returns` was off.
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/returnable`,
      cookies: { b2b_session: 'stub-customer-session' },
      headers: channel,
    });
    expect(res.statusCode, res.body).toBe(200);
    const lines = (
      res.json() as {
        data: { lines: Array<{ productId: string; returnable: boolean; notReturnableReason?: string }> };
      }
    ).data.lines;
    expect(lines.map((l) => l.productId).sort()).toEqual([R.id, N.id].sort());
    // Phase 12a (T096): the per-line verdict `returns` derives from the stamp.
    expect(
      Object.fromEntries(lines.map((l) => [l.productId, [l.returnable, l.notReturnableReason ?? null]])),
    ).toEqual({ [R.id]: [true, null], [N.id]: [false, 'product_not_returnable'] });

    const port = (h.container.cradle as unknown as { orderReturnContextPort: OrderReturnContextPort })
      .orderReturnContextPort;
    const context = await port.getReturnContext(orderId);
    expect(
      Object.fromEntries((context?.lines ?? []).map((l) => [l.productId, l.returnableAtPurchase])),
    ).toEqual({ [R.id]: true, [N.id]: false });
  }, 120_000);

  /**
   * `specs/170-organization-roles/` WP-14, T146 (FR-007, FR-025, SC-007; US 8).
   * The two organization permissions this module declares (OR-11) follow its
   * presence: while `returns` is off, `returns.create` and
   * `returns.view_organization` leave the permission catalogue, every
   * member's effective set (`GET …/mine/role`) and the session's
   * `permissions` (`GET /api/v1/me`); a custom role's stored grant of them is
   * kept; on reactivation both are back everywhere.
   */
  describe('the returns organization permissions (170 WP-14)', () => {
    const CODES = ['returns.create', 'returns.view_organization'] as const;
    let administrator: ReturnsFixtureMember;
    let member: ReturnsFixtureMember;
    let holder: ReturnsFixtureMember;

    beforeAll(async () => {
      const em = h.em();
      const org = await makeOrganization(em, 'WP14 Off-state');
      administrator = await makeMember(em, org, 'administrator', { label: 'OffAdmin' });
      member = await makeMember(em, org, 'member', { label: 'OffMember' });
      holder = await makeMember(em, org, { permissions: [...CODES] }, { label: 'OffHolder' });
    });

    afterAll(() => {
      releaseMembers();
    });

    const get = async (who: ReturnsFixtureMember, url: string) => {
      const res = await h.app.inject({ method: 'GET', url, cookies: { b2b_session: who.cookie } });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
      return res.json() as { data: unknown };
    };
    const catalogueCodes = async (): Promise<string[]> => {
      const body = (await get(administrator, '/api/v1/organizations/mine/permission-catalogue')) as {
        data: { groups: Array<{ permissions: Array<{ code: string }> }> };
      };
      return body.data.groups.flatMap((g) => g.permissions.map((p) => p.code));
    };
    const roleCodes = async (who: ReturnsFixtureMember): Promise<string[]> => {
      const body = (await get(who, '/api/v1/organizations/mine/role')) as {
        data: { permissions: Array<{ code: string }> };
      };
      return body.data.permissions.map((p) => p.code);
    };
    const sessionCodes = async (who: ReturnsFixtureMember): Promise<string[]> => {
      const body = (await get(who, '/api/v1/me')) as { data: { customerAccount: { permissions: string[] } } };
      return body.data.customerAccount.permissions;
    };
    const storedGrants = async (): Promise<string[]> => {
      const [row] = (await h.em().getConnection().execute(
        `select "permissions" from "organization_roles" where "id" = ?`,
        [holder.roleId],
      )) as Array<{ permissions: string[] }>;
      return row!.permissions;
    };

    async function expectPresent(): Promise<void> {
      expect(await catalogueCodes()).toEqual(expect.arrayContaining([...CODES]));
      for (const who of [administrator, holder]) {
        expect(await roleCodes(who)).toEqual(expect.arrayContaining([...CODES]));
        expect(await sessionCodes(who)).toEqual(expect.arrayContaining([...CODES]));
      }
      // *Member* holds the member default and not the other code.
      expect(await roleCodes(member)).toContain('returns.create');
      expect(await roleCodes(member)).not.toContain('returns.view_organization');
      expect(await sessionCodes(member)).toContain('returns.create');
      expect(await storedGrants()).toEqual(expect.arrayContaining([...CODES]));
    }

    it('are offered and held while on — the positive control', async () => {
      await expectPresent();
    });

    it.each(['deactivated', 'platform-unavailable'] as const)(
      'while %s they leave the catalogue and every effective set, keep the stored grant, and are back after',
      async (axis) => {
        await withModuleOff('returns', axis, async () => {
          const catalogue = await catalogueCodes();
          for (const who of [administrator, member, holder]) {
            const role = await roleCodes(who);
            const session = await sessionCodes(who);
            for (const code of CODES) {
              expect(catalogue).not.toContain(code);
              expect(role).not.toContain(code);
              expect(session).not.toContain(code);
            }
          }
          expect(await storedGrants()).toEqual(expect.arrayContaining([...CODES]));
        });
        await expectPresent();
      },
    );
  });
});
