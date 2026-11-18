import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CustomerAccount, ReturnCase, ReturnCaseItem, ReturnReason } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { buyerChannelIds, createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { resetReturnGraph } from './helpers.js';
import { asMember, makeMember, makeOrganization, releaseMembers } from './organization-fixtures.js';
import { allowOffPlatform, complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';
import { captureReturnsNotificationJobs, type CapturedReturnsJob } from './notification-jobs.js';

/**
 * `specs/180-off-platform-complaints/` T056, T057 (FR-B10 – FR-B17, R-17, R-18,
 * Principle XI): filing a complaint without a platform order.
 */
describe('returns — a complaint without a platform order', () => {
  let h: BackendServerHandle;
  let reasonId: string;
  let productId: string;
  let hiddenProductId: string;
  let undo: () => Promise<void>;
  const jobs: CapturedReturnsJob[] = [];
  const CHANNEL = { 'x-sales-channel': 'default' };

  beforeAll(async () => {
    h = await setupBackendServer({ moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    const RUN = minimumFixtureRun();
    const channels = await buyerChannelIds(h.em());
    productId = (await createMinimumProduct(h.em(), { sku: `OP-${RUN}`, nameEn: `Drill ${RUN}`, namePl: `Wiertarka ${RUN}`, channelIds: channels })).id;
    hiddenProductId = (await createMinimumProduct(h.em(), { sku: `OPH-${RUN}`, nameEn: `Hidden ${RUN}`, namePl: `Ukryty ${RUN}`, channelIds: [] })).id;
    undo = await allowOffPlatform(h);
  });
  afterAll(async () => {
    await undo();
    releaseMembers();
    await teardownBackendServer(h);
  });

  const errorOf = (res: { json: () => unknown }) => (res.json() as { error: { code: string; details?: { code?: string; reasonId?: string } } }).error;

  it('files one catalog line and one free-text line with a serial number', async () => {
    const before = await h.em().fork().findOneOrFail(CustomerAccount, { id: TEST_CUSTOMER_ID });
    const body = noOrderBody(reasonId, {
      lines: [
        { productId, quantity: 1, reasonId, description: 'Does not start' },
        { modelName: 'Drill X200', quantity: 2, reasonId, description: 'Battery swells', serialNumber: 'SN-1' },
      ],
    });
    const res = await file(h, body, { headers: CHANNEL });
    expect(res.statusCode, res.body).toBe(201);
    const detail = (res.json() as { data: Record<string, unknown> & { id: string } }).data;
    expect(detail).toMatchObject({
      orderId: null,
      offPlatform: true,
      kind: 'complaint',
      organizationId: TEST_ORGANIZATION_ID,
      totalRefundAmount: 0,
      purchase: { proofNumber: 'FV/180/2026', date: '2026-10-01' },
      contact: { name: 'Ewa Nowak', email: 'ewa@example.test', phone: '+48 600 000 000' },
      returnAddress: { name: 'Ewa Nowak', street: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
    });

    const em = h.em().fork();
    const rc = await em.findOneOrFail(ReturnCase, { id: detail.id }, { filters: false });
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    expect(rc.salesChannelId).toBe(channel.id);
    expect(rc.currency).toBe(channel.defaultCurrency);
    const items = await em.find(ReturnCaseItem, { returnCaseId: rc.id }, { orderBy: { productName: 'asc' } });
    const catalog = items.find((it) => it.productId === productId)!;
    expect(catalog.productName).toContain('Drill');
    const typed = items.find((it) => it.productId == null)!;
    expect(typed).toMatchObject({ productName: 'Drill X200', serialNumber: 'SN-1' });
    expect(typed.orderItemId ?? null).toBeNull();
    for (const it of items) expect([it.defaultRefundAmount, it.approvedRefundAmount].map(Number)).toEqual([0, 0]);

    // The account and its address book are untouched.
    const after = await h.em().fork().findOneOrFail(CustomerAccount, { id: TEST_CUSTOMER_ID });
    expect([after.firstName, after.lastName, after.email]).toEqual([before.firstName, before.lastName, before.email]);
  });

  it('refuses a purchase date in the future', async () => {
    const res = await file(h, noOrderBody(reasonId, { purchase: { date: '2999-01-01' } }), { headers: CHANNEL });
    expect(res.statusCode).toBe(422);
    expect(errorOf(res).details?.code).toBe('purchase_date_in_future');
  });

  it('refuses a product not available on the channel as unknown', async () => {
    for (const id of [hiddenProductId, randomUUID()]) {
      const lines = [{ productId: id, quantity: 1, reasonId, description: 'x' }];
      const res = await file(h, noOrderBody(reasonId, { lines }), { headers: CHANNEL });
      expect(res.statusCode).toBe(422);
      expect(errorOf(res).details?.code).toBe('unknown_product');
    }
  });

  it('refuses a line with neither product nor model', async () => {
    const res = await file(h, noOrderBody(reasonId, { lines: [{ quantity: 1, reasonId, description: 'x' }] }), { headers: CHANNEL });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('product_or_model_required');
  });

  it('refuses a return-only reason as unknown and a switched-off one as inactive (issue #625)', async () => {
    const em = h.em().fork();
    const returnOnly = em.create(ReturnReason, { label: { en: 'Changed my mind' }, appliesTo: 'return' });
    const inactive = em.create(ReturnReason, { label: { en: 'Old' }, appliesTo: 'complaint', isActive: false });
    await em.flush();
    const lineWith = (id: string) => [{ modelName: 'X', quantity: 1, reasonId: id, description: 'x' }];

    const unknown = await file(h, noOrderBody(reasonId, { lines: lineWith(returnOnly.id) }), { headers: CHANNEL });
    expect(unknown.statusCode).toBe(422);
    expect(errorOf(unknown).code).toBe('VALIDATION_FAILED');
    expect(errorOf(unknown).details?.code).toBe('unknown_reason');

    const switchedOff = await file(h, noOrderBody(reasonId, { lines: lineWith(inactive.id) }), { headers: CHANNEL });
    expect(switchedOff.statusCode).toBe(422);
    expect(errorOf(switchedOff).code).toBe('RETURN_REASON_INACTIVE');
    expect(errorOf(switchedOff).details?.reasonId).toBe(inactive.id);
  });

  it('refuses kind return without an order', async () => {
    const res = await file(h, noOrderBody(reasonId, { kind: 'return' }), { headers: CHANNEL });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a member without returns.create, and hides the case from another organization', async () => {
    const em = h.em();
    const org = await makeOrganization(em, '180 no-create');
    const viewer = await makeMember(em, org, { permissions: ['orders.view_organization'] }, { label: 'NoCreate180' });
    const refused = await asMember(h, viewer, 'POST', '/api/v1/returns', noOrderBody(reasonId));
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);

    const mine = await file(h, noOrderBody(reasonId), { headers: CHANNEL });
    const id = (mine.json() as { data: { id: string } }).data.id;
    const other = await makeMember(em, org, 'administrator', { label: 'OtherOrg180' });
    expect((await asMember(h, other, 'GET', `/api/v1/returns/${id}`)).statusCode).toBe(404);
  });

  it('files once for a repeated submission key, answering the same case (T057)', async () => {
    const submissionKey = randomUUID();
    const first = await file(h, noOrderBody(reasonId, { submissionKey }), { headers: CHANNEL });
    const second = await file(h, noOrderBody(reasonId, { submissionKey }), { headers: CHANNEL });
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(200);
    const id = (first.json() as { data: { id: string } }).data.id;
    expect((second.json() as { data: { id: string } }).data.id).toBe(id);
    expect(await h.em().fork().count(ReturnCase, { submissionKey }, { filters: false })).toBe(1);
    expect(jobs.filter((j) => j.kind === 'case_submitted' && j.returnCaseId === id)).toHaveLength(1);
  });
});
