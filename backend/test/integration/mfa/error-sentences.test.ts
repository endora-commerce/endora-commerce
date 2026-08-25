import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { MfaEnrolment } from '../../helpers/package-entities.js';

/**
 * Issue #223 — an `MFA_*` refusal reaches the person as a sentence, not as the
 * raw code.
 *
 * `moduleIdForErrorCode` had no rule for the family, so every one of these
 * codes resolved against the `core` bundle, where none of their sentences live
 * or could live. The envelope replaces the message wholesale, so the outcome
 * was the code itself rendered at somebody who had just failed to sign in.
 * Issue #194 fixed the routing; these are the sentences.
 *
 * Each case asserts wording that differs from the prose the thrower wrote —
 * that difference is the whole proof, because a matching string would pass just
 * as well with no translation happening at all (the composition root answers a
 * missed key with the original message).
 *
 * Three of the nine codes are reachable over HTTP without an enrolment, so
 * three are proven here end to end; the remaining six are held by
 * `check:error-translations`, which fails on a code with no sentence in either
 * shipped language.
 */
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const CUSTOMER_EMAIL = 'stub-customer@example.com';

describe('MFA refusals render their sentence, not their code (issue #223)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Both preconditions are stated rather than inherited. The settings value
    // and the enrolment rows outlive a single file in this suite, so a sibling
    // that enables storefront TOTP or leaves a pending enrolment behind would
    // otherwise decide these two refusals by test order — which it did, on the
    // first run of this file after the whole folder.
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.totp_enabled',
      false,
      null,
      { actorAdminUserId: null },
    );
    const em = h.em();
    const customer = await em.findOne(CustomerAccount, { email: CUSTOMER_EMAIL });
    expect(customer, 'the stub customer this file signs in as').not.toBeNull();
    await em.nativeDelete(MfaEnrolment, {
      subjectType: 'customer',
      subjectId: customer!.id,
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('names the expired login step instead of MFA_INVALID_CHALLENGE', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: 'no-such-challenge', code: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe('MFA_INVALID_CHALLENGE');
    expect(res.json().error?.message).toBe(
      'This sign-in step is no longer valid — it has expired, or it was already ' +
        'finished. Sign in again to start a new one.',
    );
  });

  it('says who decides availability instead of MFA_NOT_ENABLED', async () => {
    // No `mfa.storefront.totp_enabled` value is written by this file, so the
    // policy resolves to off and self-enrolment is refused (FR-001).
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/setup',
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('MFA_NOT_ENABLED');
    expect(res.json().error?.message).toBe(
      'Two-factor authentication is not available here, so it cannot be switched on ' +
        'for this account. Your administrator decides where it can be used — ask them ' +
        'to enable it.',
    );
  });

  it('says what to do next instead of MFA_NO_PENDING_ENROLMENT', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: CUSTOMER_COOKIE,
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe('MFA_NO_PENDING_ENROLMENT');
    expect(res.json().error?.message).toBe(
      'There is no setup waiting to be confirmed — it was either finished already, or ' +
        'started again somewhere else. Begin the setup again and scan the new QR code ' +
        'before entering a code.',
    );
  });
});
