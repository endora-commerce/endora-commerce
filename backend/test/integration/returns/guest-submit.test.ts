import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ReturnCase, ReturnCaseClause } from '../../helpers/package-entities.js';
import { buyerChannelIds, createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, resetReturnGraph } from './helpers.js';
import { PROOF_REQUIRED_SETTING, complaintReasonId } from './off-platform-fixtures.js';
import { captureReturnsNotificationJobs, overrideReturnsSetting, type CapturedReturnsJob } from './notification-jobs.js';
import {
  GUEST_COOKIE,
  GUEST_PDF,
  GUEST_SETTING,
  allowGuests,
  caseIdOfToken,
  fileAsGuest,
  guestBody,
  guestFormConfig,
  guestUpload,
  openGuestSession,
} from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T025 (US1; FR-030 – FR-036; research R-1, R-4, R-6, R-8):
 * filing a complaint as a guest with a verified e-mail address (G5, G7).
 *
 * - The case carries no account and no organization; its contact address is the
 *   session's verified one, and it records the session and tracking version 1.
 * - 180's rules for a complaint without an order hold unchanged.
 * - A submission key is the session's; the honeypot creates nothing; the per-session
 *   and per-address limits answer 429.
 * - A customer session on the same request is ignored: it neither attributes the case
 *   nor scopes the request (lead ruling 1 on batch 2).
 * - `return_case.create` is audited once, as a guest's filing.
 */
describe('returns — a guest files a complaint', () => {
  let h: BackendServerHandle;
  let reasonId: string;
  let productId: string;
  let hiddenProductId: string;
  let undo: () => Promise<void>;
  const jobs: CapturedReturnsJob[] = [];

  const errorOf = (res: { json: () => unknown }) =>
    (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
  const filedOf = (res: { json: () => unknown }) =>
    (res.json() as { data: { reference: string; trackingToken: string; email: string } }).data;
  const casesOfSession = (verificationId: string) =>
    h.em().fork().find(ReturnCase, { guestSessionId: verificationId }, { filters: false });

  beforeAll(async () => {
    h = await setupBackendServer({ moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    const RUN = minimumFixtureRun();
    const channels = await buyerChannelIds(h.em());
    productId = (await createMinimumProduct(h.em(), { sku: `GS-${RUN}`, nameEn: `Saw ${RUN}`, namePl: `Piła ${RUN}`, channelIds: channels })).id;
    hiddenProductId = (await createMinimumProduct(h.em(), { sku: `GSH-${RUN}`, nameEn: `Hidden ${RUN}`, namePl: `Ukryta ${RUN}`, channelIds: [] })).id;
    undo = await allowGuests(h);
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  it('files a case with no account and no organization, stamped from the session (FR-030 – FR-033)', async () => {
    const session = await openGuestSession(h);
    const res = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { lines: [{ productId, quantity: 1, reasonId, description: 'Blade broke' }] }));
    expect(res.statusCode, res.body).toBe(201);
    const filed = filedOf(res);
    expect(filed.email).toBe(session.email);
    expect(filed.reference).toMatch(/^#[0-9A-F]{8}$/);
    expect(filed.trackingToken.length).toBeGreaterThan(40);

    const caseId = caseIdOfToken(h, filed.trackingToken);
    const rc = await h.em().fork().findOneOrFail(ReturnCase, { id: caseId }, { filters: false });
    expect(rc.customerAccountId ?? null).toBeNull();
    expect(rc.organizationId ?? null).toBeNull();
    expect(rc.orderId ?? null).toBeNull();
    expect(rc.kind).toBe('complaint');
    expect(rc.guestSessionId).toBe(session.verificationId);
    expect(rc.trackingVersion).toBe(1);
    expect(rc.contactVerifiedAt).toBeInstanceOf(Date);
    expect(rc.contact).toEqual({ name: 'Gość Kowalski', email: session.email, phone: '+48 600 000 181' });
    expect(jobs).toContainEqual({ kind: 'case_submitted', returnCaseId: caseId });
  });

  it('answers the form configuration for the session: the verified address, the confirmation always on (G5)', async () => {
    const session = await openGuestSession(h);
    const res = await guestFormConfig(h, session.sessionToken);
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      verifiedEmail: session.email,
      confirmationEmailEnabled: true,
      offPlatformComplaintsEnabled: true,
    });
    expect(typeof data['sessionExpiresAt']).toBe('string');
    // The active complaint reasons, as the customer's `/returns/reasons?kind=complaint`
    // answers them: the guest's form needs them and has no customer session (batch 4 gap).
    const reasons = data['reasons'] as Array<{ id: string; appliesTo: string }>;
    expect(reasons.map((r) => r.id)).toContain(reasonId);
    expect(reasons.every((r) => r.appliesTo === 'complaint' || r.appliesTo === 'both')).toBe(true);
    expect((await guestFormConfig(h, null)).statusCode).toBe(401);
  });

  describe('180’s rules for a complaint without an order', () => {
    it('requires a proof of purchase while the setting asks for one', async () => {
      const restore = await overrideReturnsSetting(h, PROOF_REQUIRED_SETTING, true);
      try {
        const session = await openGuestSession(h);
        const refused = await fileAsGuest(h, session.sessionToken, guestBody(reasonId));
        expect(refused.statusCode).toBe(422);
        expect(errorOf(refused).code).toBe(ERROR_CODES.RETURN_PROOF_OF_PURCHASE_REQUIRED);
        const uploadId = (((await guestUpload(h, session.sessionToken, GUEST_PDF)).json()) as { data: { uploadId: string } }).data.uploadId;
        const ok = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { attachments: [{ uploadId }] }));
        expect(ok.statusCode, ok.body).toBe(201);
      } finally {
        await restore();
      }
    });

    it('refuses a purchase date in the future and a product the anonymous audience cannot see', async () => {
      const session = await openGuestSession(h);
      const future = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { purchase: { date: '2999-01-01' } }));
      expect(future.statusCode).toBe(422);
      expect(errorOf(future).details?.['code']).toBe('purchase_date_in_future');
      for (const id of [hiddenProductId, randomUUID()]) {
        const res = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { lines: [{ productId: id, quantity: 1, reasonId, description: 'x' }] }));
        expect(res.statusCode).toBe(422);
        expect(errorOf(res).details?.['code']).toBe('unknown_product');
      }
    });

    it('refuses a must-accept clause left unticked', async () => {
      const em = h.em().fork();
      const clause = em.create(ReturnCaseClause, { label: { en: 'Terms' }, text: { en: 'Accept the terms' } });
      await em.flush();
      try {
        const session = await openGuestSession(h);
        const shown = [{ id: clause.id, revision: clause.revision }];
        const refused = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { shownClauses: shown, acceptedClauses: [] }));
        expect(refused.statusCode).toBe(422);
        expect(errorOf(refused).code).toBe(ERROR_CODES.RETURN_CLAUSES_NOT_ACCEPTED);
        const ok = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { shownClauses: shown, acceptedClauses: shown }));
        expect(ok.statusCode, ok.body).toBe(201);
      } finally {
        await h.em().fork().nativeDelete(ReturnCaseClause, { id: clause.id });
      }
    });
  });

  it('answers a repeated submission key with the case already filed, in the same session only (R-4)', async () => {
    const session = await openGuestSession(h);
    const submissionKey = randomUUID();
    const first = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { submissionKey }));
    const second = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { submissionKey }));
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(200);
    expect(filedOf(second).reference).toBe(filedOf(first).reference);
    expect(filedOf(second).trackingToken).toBe(filedOf(first).trackingToken);
    expect(await casesOfSession(session.verificationId)).toHaveLength(1);

    const other = await openGuestSession(h);
    const elsewhere = await fileAsGuest(h, other.sessionToken, guestBody(reasonId, { submissionKey }));
    expect(elsewhere.statusCode, elsewhere.body).toBe(201);
    expect(filedOf(elsewhere).reference).not.toBe(filedOf(first).reference);
  });

  it('answers a honeypot hit like a success and creates nothing (R-8)', async () => {
    const session = await openGuestSession(h);
    const res = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { hp: 'https://spam.example' }));
    expect(res.statusCode, res.body).toBe(201);
    expect(filedOf(res).email).toBe(session.email);
    expect(await casesOfSession(session.verificationId)).toHaveLength(0);
  });

  it('refuses a sixth case in one session, and an eleventh for one address in 24 hours (429)', async () => {
    const email = `limit-${randomUUID()}@example.test`;
    const a = await openGuestSession(h, { email });
    for (let i = 0; i < 5; i += 1) expect((await fileAsGuest(h, a.sessionToken, guestBody(reasonId))).statusCode).toBe(201);
    const sixth = await fileAsGuest(h, a.sessionToken, guestBody(reasonId));
    expect(sixth.statusCode).toBe(429);
    expect(errorOf(sixth)).toMatchObject({ code: ERROR_CODES.RETURN_GUEST_LIMIT_REACHED, details: { limit: 'cases_per_session' } });

    const b = await openGuestSession(h, { email: email.toUpperCase() });
    for (let i = 0; i < 5; i += 1) expect((await fileAsGuest(h, b.sessionToken, guestBody(reasonId))).statusCode).toBe(201);
    const c = await openGuestSession(h, { email });
    const eleventh = await fileAsGuest(h, c.sessionToken, guestBody(reasonId));
    expect(eleventh.statusCode).toBe(429);
    expect(errorOf(eleventh)).toMatchObject({ code: ERROR_CODES.RETURN_GUEST_LIMIT_REACHED, details: { limit: 'cases_per_address' } });
  });

  it('refuses a body naming an account, an organization or an order, or asking for a return (FR-034)', async () => {
    const session = await openGuestSession(h);
    for (const over of [
      { customerAccountId: randomUUID() },
      { organizationId: randomUUID() },
      { orderId: randomUUID() },
      { orderId: null },
      { kind: 'return' },
      { contact: { name: 'X', email: 'other@example.test' } },
    ]) {
      const res = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, over));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
      expect(errorOf(res).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
    expect(await casesOfSession(session.verificationId)).toHaveLength(0);
  });

  it('refuses a request with no live session (401) and while guest complaints are off (403)', async () => {
    expect((await fileAsGuest(h, null, guestBody(reasonId))).statusCode).toBe(401);
    expect((await fileAsGuest(h, 'not-a-session', guestBody(reasonId))).statusCode).toBe(401);
    const session = await openGuestSession(h);
    const restore = await overrideReturnsSetting(h, GUEST_SETTING, false);
    try {
      const refused = await fileAsGuest(h, session.sessionToken, guestBody(reasonId));
      expect(refused.statusCode).toBe(403);
      expect(errorOf(refused).code).toBe(ERROR_CODES.RETURN_GUEST_COMPLAINTS_DISABLED);
    } finally {
      await restore();
    }
  });

  it('ignores a signed-in customer’s session on the same request: the case is the guest’s (FR-033, ruling 1)', async () => {
    const session = await openGuestSession(h);
    const res = await fileAsGuest(h, session.sessionToken, guestBody(reasonId), { cookies: { ...CUSTOMER_COOKIE } });
    expect(res.statusCode, res.body).toBe(201);
    const caseId = caseIdOfToken(h, filedOf(res).trackingToken);
    const rc = await h.em().fork().findOneOrFail(ReturnCase, { id: caseId }, { filters: false });
    expect(rc.customerAccountId ?? null).toBeNull();
    expect(rc.organizationId ?? null).toBeNull();
    // Replaying the key with the customer cookie still finds the guest's case: the
    // request ran in the anonymous scope, where a case with no organization is readable.
    const key = randomUUID();
    const first = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { submissionKey: key }), { cookies: { ...CUSTOMER_COOKIE } });
    const again = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { submissionKey: key }), { cookies: { ...CUSTOMER_COOKIE } });
    expect(first.statusCode, first.body).toBe(201);
    expect(again.statusCode, again.body).toBe(200);
    expect(filedOf(again).reference).toBe(filedOf(first).reference);
    // And the customer sees none of it in their own list.
    const listed = await h.app.inject({ method: 'GET', url: '/api/v1/returns', cookies: { ...CUSTOMER_COOKIE, [GUEST_COOKIE]: session.sessionToken } });
    const ids = (listed.json() as { data: Array<{ id: string }> }).data.map((c) => c.id);
    expect(ids).not.toContain(caseId);
  });

  it('audits return_case.create once, as a guest’s filing, with names and counts only (R-6)', async () => {
    const session = await openGuestSession(h);
    const res = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { comment: 'Please call me' }));
    expect(res.statusCode, res.body).toBe(201);
    const caseId = caseIdOfToken(h, filedOf(res).trackingToken);
    const entries = await h.em().fork().find(AuditLogEntry, { objectType: 'return_case', objectId: caseId, action: 'return_case.create' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorAdminUserId ?? null).toBeNull();
    expect(entries[0]!.stateAfter).toMatchObject({ by: 'guest', guestSessionId: session.verificationId, offPlatform: true, kind: 'complaint' });
    const serialised = JSON.stringify(entries[0]!.stateAfter);
    for (const value of [session.email, 'Gość Kowalski', 'Prosta 2', 'Please call me', '+48 600 000 181']) {
      expect(serialised).not.toContain(value);
    }
    // The case reads as a guest's for the operator.
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${caseId}`, cookies: ADMIN_COOKIE });
    expect((detail.json() as { data: { guest: boolean; customerAccountId: string | null } }).data).toMatchObject({ guest: true, customerAccountId: null });
  });
});
