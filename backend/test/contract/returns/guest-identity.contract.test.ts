import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ERROR_CODES,
  guestAvailabilitySchema,
  guestSessionSchema,
  guestVerificationAcceptedSchema,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CUSTOMER_COOKIE } from '../../integration/returns/helpers.js';
import { overrideReturnsSetting } from '../../integration/returns/notification-jobs.js';
import {
  GUEST_SETTING,
  allowGuests,
  freshEmail,
  leave,
  openGuestSession,
  redeem,
  requestLink,
  verificationTokenOf,
  verificationsOf,
} from '../../integration/returns/guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T023, contracts/guest-api.md G1 – G4: the shapes of the
 * guest identity routes and their error envelopes — and the order of their checks
 * (research R-12: setting, then session, then body).
 */
const envelope = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }) });

describe('guest identity API (G1 – G4)', () => {
  let h: BackendServerHandle;
  let undo: () => Promise<void>;

  beforeAll(async () => {
    h = await setupBackendServer();
    undo = await allowGuests(h);
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  const errorOf = (body: string) => envelope.parse(JSON.parse(body)).error;

  it('G1 answers { data: { enabled } }, with no session and with a customer one alike', async () => {
    for (const cookies of [undefined, CUSTOMER_COOKIE]) {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/returns/guest/availability',
        headers: { 'x-sales-channel': 'default' },
        ...(cookies ? { cookies } : {}),
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(guestAvailabilitySchema.strict().parse((res.json() as { data: unknown }).data)).toEqual({ enabled: true });
    }
  });

  it('G2 answers 202 { data: { linkValidMinutes } } and nothing else', async () => {
    const res = await requestLink(h, { email: freshEmail() });
    expect(res.statusCode).toBe(202);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['data']);
    expect(guestVerificationAcceptedSchema.strict().parse(body['data'])).toEqual({ linkValidMinutes: 60 });
  });

  it('G2 refuses a malformed or a strict-violating body with 400 VALIDATION_FAILED', async () => {
    for (const body of [{ email: 'nope' }, { email: freshEmail(), salesChannelId: 'x' }, {}]) {
      const res = await requestLink(h, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res.body).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it('G3 answers 201 { data: { sessionToken, email, expiresAt } }', async () => {
    const email = freshEmail();
    await requestLink(h, { email });
    const [row] = await verificationsOf(h, email);
    const res = await redeem(h, verificationTokenOf(h, row!.id));
    expect(res.statusCode, res.body).toBe(201);
    const data = guestSessionSchema.strict().parse((res.json() as { data: unknown }).data);
    expect(data.email).toBe(email);
  });

  it('G3 answers an invalid link with 410 RETURN_GUEST_LINK_INVALID, and an over-long token with 400', async () => {
    const res = await redeem(h, 'not-a-link');
    expect(res.statusCode).toBe(410);
    expect(errorOf(res.body).code).toBe(ERROR_CODES.RETURN_GUEST_LINK_INVALID);
    const long = await redeem(h, 'x'.repeat(513));
    expect(long.statusCode).toBe(400);
    expect(errorOf(long.body).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('G4 answers 204 with no body, then 401 RETURN_GUEST_SESSION_REQUIRED', async () => {
    const { sessionToken } = await openGuestSession(h);
    const res = await leave(h, sessionToken);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const again = await leave(h, sessionToken);
    expect(again.statusCode).toBe(401);
    expect(errorOf(again.body).code).toBe(ERROR_CODES.RETURN_GUEST_SESSION_REQUIRED);
  });

  it('checks the setting before the body: with guest complaints off, a malformed body is 403', async () => {
    const restore = await overrideReturnsSetting(h, GUEST_SETTING, false);
    try {
      for (const res of [await requestLink(h, { email: 'nope' }), await redeem(h, 'x'.repeat(600))]) {
        expect(res.statusCode).toBe(403);
        const error = errorOf(res.body);
        expect(error.code).toBe(ERROR_CODES.RETURN_GUEST_COMPLAINTS_DISABLED);
        expect(error.message).not.toMatch(/^[A-Z_]+$/);
      }
    } finally {
      await restore();
    }
  });

  it('translates every refusal into the request language', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns/guest/sessions',
      headers: { 'x-sales-channel': 'default', 'accept-language': 'pl' },
      payload: { token: 'not-a-link' },
    });
    expect(errorOf(res.body).message).toBe('Ten link już nie działa. Poproś o nowy.');
  });
});
