import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ERROR_CODES,
  guestCaseFiledSchema,
  guestFormConfigSchema,
  returnUploadSchema,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { resetReturnGraph } from '../../integration/returns/helpers.js';
import { complaintReasonId } from '../../integration/returns/off-platform-fixtures.js';
import { overrideReturnsSetting } from '../../integration/returns/notification-jobs.js';
import {
  GUEST_SETTING,
  allowGuests,
  fileAsGuest,
  guestBody,
  guestFormConfig,
  guestUpload,
  openGuestSession,
} from '../../integration/returns/guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T034, contracts/guest-api.md G5 – G7: the shapes of the
 * guest form, upload and filing routes, their error envelopes, and the order of their
 * checks (research R-12: setting, then session, then body).
 */
const envelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string().optional() }),
});

describe('guest filing API (G5 – G7)', () => {
  let h: BackendServerHandle;
  let reasonId: string;
  let undo: () => Promise<void>;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    undo = await allowGuests(h);
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  const errorOf = (body: string) => envelope.parse(JSON.parse(body)).error;

  it('G5 answers { data: GuestFormConfig }', async () => {
    const { sessionToken, email } = await openGuestSession(h);
    const res = await guestFormConfig(h, sessionToken);
    expect(res.statusCode, res.body).toBe(200);
    const data = guestFormConfigSchema.parse((res.json() as { data: unknown }).data);
    expect(data.verifiedEmail).toBe(email);
    expect(data.confirmationEmailEnabled).toBe(true);
  });

  it('G6 answers 201 { data: ReturnUpload }', async () => {
    const { sessionToken } = await openGuestSession(h);
    const res = await guestUpload(h, sessionToken);
    expect(res.statusCode, res.body).toBe(201);
    returnUploadSchema.strict().parse((res.json() as { data: unknown }).data);
  });

  it('G7 answers 201 { data: { reference, trackingToken, email } } and nothing else', async () => {
    const { sessionToken, email } = await openGuestSession(h);
    const res = await fileAsGuest(h, sessionToken, guestBody(reasonId));
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['data']);
    const data = guestCaseFiledSchema.strict().parse(body['data']);
    expect(data.email).toBe(email);
  });

  it('G7 refuses a strict-violating body with 400 VALIDATION_FAILED', async () => {
    const { sessionToken } = await openGuestSession(h);
    for (const over of [{ organizationId: '00000000-0000-4000-8000-000000000001' }, { lines: [] }, { kind: 'return' }]) {
      const res = await fileAsGuest(h, sessionToken, guestBody(reasonId, over));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
      expect(errorOf(res.body).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it('answers 401 RETURN_GUEST_SESSION_REQUIRED on G5 – G7 without a session, before the body', async () => {
    for (const res of [
      await guestFormConfig(h, null),
      await guestUpload(h, null),
      await fileAsGuest(h, null, { nonsense: true }),
    ]) {
      expect(res.statusCode, res.body).toBe(401);
      expect(errorOf(res.body).code).toBe(ERROR_CODES.RETURN_GUEST_SESSION_REQUIRED);
    }
  });

  it('checks the setting before the session: with guest complaints off, G5 – G7 answer 403', async () => {
    const restore = await overrideReturnsSetting(h, GUEST_SETTING, false);
    try {
      for (const res of [await guestFormConfig(h, null), await guestUpload(h, null), await fileAsGuest(h, null, { nonsense: true })]) {
        expect(res.statusCode, res.body).toBe(403);
        expect(errorOf(res.body).code).toBe(ERROR_CODES.RETURN_GUEST_COMPLAINTS_DISABLED);
      }
    } finally {
      await restore();
    }
  });

  it('answers the limit with 429 RETURN_GUEST_LIMIT_REACHED and its details', async () => {
    const { sessionToken } = await openGuestSession(h);
    for (let i = 0; i < 5; i += 1) await fileAsGuest(h, sessionToken, guestBody(reasonId));
    const res = await fileAsGuest(h, sessionToken, guestBody(reasonId), { headers: { 'accept-language': 'pl' } });
    expect(res.statusCode).toBe(429);
    const error = errorOf(res.body);
    expect(error.code).toBe(ERROR_CODES.RETURN_GUEST_LIMIT_REACHED);
    expect(error.details).toEqual({ limit: 'cases_per_session' });
    expect(error.message).not.toMatch(/^[A-Z_]+$/);
  });
});
