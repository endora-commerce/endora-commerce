import { randomUUID } from 'node:crypto';
import { asValue, type Resolver } from 'awilix';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type AdminTenantScopePort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { complaintReasonId } from './off-platform-fixtures.js';
import { captureReturnsNotificationJobs, type CapturedReturnsJob } from './notification-jobs.js';
import { allowGuests, fileGuestCase, type FiledGuestCase } from './guest-fixtures.js';
import { makeMember, makeOrganization, releaseMembers } from './organization-fixtures.js';

/**
 * `specs/181-guest-complaints/` T045 (US3; FR-062; research R-1 *Cross-tenant tests
 * required*, R-10) — **the Principle XI matrix.**
 *
 * A guest case carries neither an account nor an organization, so only the unrestricted
 * tenant modes (`all`, `system`) can read it. Every admin route that names a case is
 * walked here for the two restricted admin kinds — a sales representative
 * (`excluded-set`) and an admin confined to an allowed set (`allowed-set`) — and each
 * must answer exactly what it answers for a case that does not exist. The list, its
 * counts, its search (the contact e-mail included), the export and a saved view must
 * omit the case. A positive control per kind proves the 404 is the tenant filter's and
 * not a missing permission: each restricted admin reads a customer case of an
 * organization it reaches. An unrestricted admin sees everything; a signed-in customer
 * whose e-mail is the guest's contact address sees nothing.
 */
describe('returns — guest cases and the Principle XI matrix (181 T045)', () => {
  let h: BackendServerHandle;
  let undoGuests: () => Promise<void>;
  let reasonId: string;
  let guest: FiledGuestCase;
  let guestAttachmentId: string;
  let customerCaseId: string;
  let rep: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let allowed: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let originalScopePort: Resolver<unknown>;
  let repCountsBefore: Record<string, number>;
  let allowedCountsBefore: Record<string, number>;
  const jobs: CapturedReturnsJob[] = [];
  const CODES = ['returns:read', 'returns:write', 'returns:erase_personal_data'];

  const inject = (method: 'GET' | 'POST' | 'DELETE', url: string, cookies: Record<string, string>, payload?: object) =>
    h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload } : {}) });
  const errorOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error;

  type Row = { id: string; guest: boolean; customerName: string | null };
  const listAs = async (cookies: Record<string, string>, qs = ''): Promise<{ rows: Row[]; total: number; counts: Record<string, number> }> => {
    const res = await inject('GET', `/api/v1/admin/returns?pageSize=200${qs}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { rows: Row[]; total: number; counts: Record<string, number> } }).data;
  };
  const exportAs = async (cookies: Record<string, string>, qs = ''): Promise<string> => {
    const res = await inject('GET', `/api/v1/admin/returns/export?pageSize=200${qs}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return res.body;
  };

  beforeAll(async () => {
    h = await setupBackendServer({ moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    undoGuests = await allowGuests(h);

    // The positive control: a customer case of the test organization, which both
    // restricted admins reach.
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    customerCaseId = (created.json() as { data: { id: string } }).data.id;

    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], CODES);
    allowed = await seedCrmAdmin(h.em(), 'guest_allowed_set', CODES);
    // An admin confined to an allowed set (API keys, the customer roll-up): the
    // composition's own port answers it for this one admin, and itself for the rest.
    originalScopePort = h.container.registrations['adminTenantScopePort'] as Resolver<unknown>;
    const real = h.container.resolve<AdminTenantScopePort>('adminTenantScopePort');
    const confined: AdminTenantScopePort = {
      resolveForAdmin: (adminUserId: string) =>
        adminUserId === allowed.adminUserId
          ? Promise.resolve({ allowAll: false, allowedOrganizationIds: [TEST_ORGANIZATION_ID] })
          : real.resolveForAdmin(adminUserId),
      resolveForAdmins: async (adminUserIds) =>
        new Map(await Promise.all(adminUserIds.map(async (id) => [id, await confined.resolveForAdmin(id)] as const))),
    };
    h.container.register({ adminTenantScopePort: asValue(confined) });

    // What each restricted admin counts before any guest case exists.
    repCountsBefore = (await listAs(rep.cookies)).counts;
    allowedCountsBefore = (await listAs(allowed.cookies)).counts;

    guest = await fileGuestCase(h, reasonId);
    const detail = await inject('GET', `/api/v1/admin/returns/${guest.caseId}`, ADMIN_COOKIE);
    expect(detail.statusCode, detail.body).toBe(200);
    guestAttachmentId = (detail.json() as { data: { attachments: Array<{ id: string }> } }).data.attachments[0]!.id;
  });

  afterAll(async () => {
    if (originalScopePort) h.container.register('adminTenantScopePort', originalScopePort);
    rep?.undo();
    allowed?.undo();
    releaseMembers();
    await undoGuests?.();
    await teardownBackendServer(h);
  });

  /** Every admin route that names one case: `[method, path suffix, body]`. */
  const caseRoutes = (attachmentId: () => string): Array<[string, 'GET' | 'POST' | 'DELETE', string, object | undefined]> => [
    ['detail', 'GET', '', undefined],
    ['comments', 'GET', '/comments', undefined],
    ['add a comment', 'POST', '/comments', { body: 'Hello', isCustomerVisible: false, notifyCustomer: false }],
    ['authorize', 'POST', '/authorize', {}],
    ['reject', 'POST', '/reject', { reason: 'No' }],
    ['transition', 'POST', '/transition', { to: 'authorized' }],
    ['settlement prefill', 'GET', '/settlement', undefined],
    ['settle', 'POST', '/settlement', { resolutionType: 'repair', lines: [] }],
    ['shipments', 'GET', '/shipments', undefined],
    ['add a shipment', 'POST', '/shipments', { direction: 'replacement' }],
    ['revoke the consent', 'DELETE', '/alternative-consent', undefined],
    ['open a file', 'GET', `/attachments/${attachmentId()}/file`, undefined],
    ['reissue the tracking link', 'POST', '/guest/tracking-link', {}],
    ['erase personal data', 'POST', '/guest/erase', { confirm: true }],
  ];

  describe.each([
    ['a sales representative (excluded set)', () => rep],
    ['an admin confined to an allowed set', () => allowed],
  ] as const)('%s', (_label, who) => {
    it('reads a customer case of an organization it reaches — the positive control', async () => {
      const res = await inject('GET', `/api/v1/admin/returns/${customerCaseId}`, who().cookies);
      expect(res.statusCode, res.body).toBe(200);
      expect((await listAs(who().cookies)).rows.map((r) => r.id)).toContain(customerCaseId);
    });

    it.each(caseRoutes(() => guestAttachmentId))('gets 404 NOT_FOUND on a guest case: %s', async (_name, method, suffix, body) => {
      const res = await inject(method, `/api/v1/admin/returns/${guest.caseId}${suffix}`, who().cookies, body);
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res)?.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('is answered for a guest case exactly as for a case that does not exist', async () => {
      const missing = await inject('GET', `/api/v1/admin/returns/${randomUUID()}`, who().cookies);
      const hidden = await inject('GET', `/api/v1/admin/returns/${guest.caseId}`, who().cookies);
      expect(hidden.statusCode).toBe(missing.statusCode);
      // The request id differs per request; the code and the sentence may not.
      const shape = (res: typeof hidden) => {
        const error = errorOf(res) as { code: string; message?: string; details?: unknown } | undefined;
        return { code: error?.code, message: error?.message, details: error?.details };
      };
      expect(shape(hidden)).toEqual(shape(missing));
    });

    it('changes nothing on the guest case through any of those routes', async () => {
      const after = await inject('GET', `/api/v1/admin/returns/${guest.caseId}`, ADMIN_COOKIE);
      const data = (after.json() as { data: { statusCode: string; comments: unknown[]; personalDataErasedAt: string | null } }).data;
      expect(data.statusCode).toBe('new');
      expect(data.comments).toEqual([]);
      expect(data.personalDataErasedAt).toBeNull();
    });

    it('skips a guest case in a bulk transition as not found', async () => {
      const res = await inject('POST', '/api/v1/admin/returns/bulk-transition', who().cookies, { ids: [guest.caseId], to: 'authorized' });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: unknown }).data).toEqual({ moved: [], skipped: [{ id: guest.caseId, reason: 'not_found' }] });
    });

    it('does not list, count, find or export a guest case', async () => {
      const all = await listAs(who().cookies);
      expect(all.rows.map((r) => r.id)).not.toContain(guest.caseId);
      expect(all.rows.some((r) => r.guest)).toBe(false);
      const before = who() === rep ? repCountsBefore : allowedCountsBefore;
      expect(all.counts).toEqual(before);

      // The guest origin exists for everyone and answers an empty list (research R-10).
      expect(await listAs(who().cookies, '&origin=guest')).toMatchObject({ rows: [], total: 0 });
      expect((await listAs(who().cookies, '&origin=off_platform')).rows.map((r) => r.id)).not.toContain(guest.caseId);

      // Search by the contact e-mail, by the derived reference.
      expect((await listAs(who().cookies, `&q=${encodeURIComponent(guest.email)}`)).rows).toEqual([]);
      expect((await listAs(who().cookies, `&q=${encodeURIComponent(guest.reference)}`)).rows).toEqual([]);

      const csv = await exportAs(who().cookies);
      expect(csv).not.toContain(guest.reference);
      expect(await exportAs(who().cookies, '&origin=guest')).not.toContain('\r\n');
    });

    it('applies a shared saved view of guest cases as an empty list', async () => {
      const created = await inject('POST', '/api/v1/admin/returns/list-views', ADMIN_COOKIE, {
        name: `Guests ${randomUUID().slice(0, 8)}`,
        shared: true,
        filters: { origin: 'guest' },
        sort: { field: 'submittedAt', dir: 'desc' },
      });
      expect(created.statusCode, created.body).toBe(201);
      const viewId = (created.json() as { data: { id: string } }).data.id;
      const views = await inject('GET', '/api/v1/admin/returns/list-views', who().cookies);
      const view = (views.json() as { data: Array<{ id: string; filters: Record<string, unknown> }> }).data.find((v) => v.id === viewId);
      expect(view?.filters).toEqual({ origin: 'guest' });
      expect((await listAs(who().cookies, `&origin=${String(view!.filters['origin'])}`)).rows).toEqual([]);
      expect((await listAs(ADMIN_COOKIE, `&origin=${String(view!.filters['origin'])}`)).rows.map((r) => r.id)).toContain(guest.caseId);
    });
  });

  describe('an unrestricted admin', () => {
    it('reads the guest case and every part of it', async () => {
      const detail = await inject('GET', `/api/v1/admin/returns/${guest.caseId}`, ADMIN_COOKIE);
      expect(detail.statusCode).toBe(200);
      expect((detail.json() as { data: { guest: boolean; customerAccountId: string | null; organizationId: string | null } }).data).toMatchObject({
        guest: true,
        customerAccountId: null,
        organizationId: null,
      });
      for (const suffix of ['/comments', '/shipments', `/attachments/${guestAttachmentId}/file`]) {
        const res = await inject('GET', `/api/v1/admin/returns/${guest.caseId}${suffix}`, ADMIN_COOKIE);
        expect(res.statusCode, `${suffix}: ${res.body}`).toBe(200);
      }
    });

    it('lists, counts, finds by the contact e-mail and exports it', async () => {
      const all = await listAs(ADMIN_COOKIE);
      expect(all.rows.find((r) => r.id === guest.caseId)).toMatchObject({ guest: true });
      expect(Object.values(all.counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(
        Object.values(repCountsBefore).reduce((a, b) => a + b, 0),
      );
      expect((await listAs(ADMIN_COOKIE, `&q=${encodeURIComponent(guest.email.toUpperCase())}`)).rows.map((r) => r.id)).toEqual([guest.caseId]);
      expect(await exportAs(ADMIN_COOKIE)).toContain(guest.reference);
    });
  });

  describe('a signed-in customer whose e-mail is the guest’s contact address', () => {
    it('neither lists nor reads the guest case', async () => {
      const organizationId = await makeOrganization(h.em(), '181 matrix');
      const member = await makeMember(h.em(), organizationId, 'administrator', { label: 'GuestTwin' });
      const twin = await fileGuestCase(h, reasonId, { email: member.email });
      const cookies = { b2b_session: member.cookie };

      const list = await inject('GET', '/api/v1/returns', cookies);
      expect(list.statusCode, list.body).toBe(200);
      expect(JSON.stringify(list.json())).not.toContain(twin.caseId);
      const read = await inject('GET', `/api/v1/returns/${twin.caseId}`, cookies);
      expect(read.statusCode).toBe(404);
      expect(read.statusCode).toBe((await inject('GET', `/api/v1/returns/${randomUUID()}`, cookies)).statusCode);
    });
  });
});
