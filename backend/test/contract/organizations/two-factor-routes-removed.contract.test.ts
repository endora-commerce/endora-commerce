import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The superseded customer 2FA path is gone.
 *
 * `POST /api/v1/me/two-factor/{enable,confirm,disable}` were served by
 * `organizations` over `customer_accounts`' `totpEnrolmentService` port. They
 * could never succeed: `enable` wrote a 682-character
 * `secret|<10 sha256 hashes>` string into `customer_accounts.two_factor_secret`,
 * a `varchar(64)`, and PostgreSQL raises `22001` rather than truncating — so
 * the answer was 500 `INTERNAL` for every customer since the routes were
 * written. The live customer 2FA surface is `mfa`'s `/api/v1/account/mfa/*`,
 * whose own migration records these columns as SUPERSEDED.
 *
 * Every request below carries a **valid** customer session cookie, so a 404
 * proves the route is not registered rather than that `requireCustomer`
 * refused — a 401 would satisfy a careless assertion and mean nothing. The
 * first case is what keeps that reading honest: the same cookie must still
 * open `GET /api/v1/me`.
 */

const CUSTOMER_SESSION = { b2b_session: 'stub-customer-session' };

describe('POST /api/v1/me/two-factor/* — removed', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('the session cookie these cases use is a valid one', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: CUSTOMER_SESSION,
    });
    expect(res.statusCode).toBe(200);
  });

  for (const path of ['enable', 'confirm', 'disable']) {
    it(`answers 404 NOT_FOUND on /api/v1/me/two-factor/${path}`, async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/me/two-factor/${path}`,
        payload: { code: '123456' },
        cookies: CUSTOMER_SESSION,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    });
  }
});
