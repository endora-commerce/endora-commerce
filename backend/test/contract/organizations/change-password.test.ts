import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T096 — `POST /me/password` must reject when `currentPassword` is wrong with
 * 401 CURRENT_PASSWORD_INVALID. No change to the stored password hash.
 */

describe('POST /api/v1/me/password — wrong current password', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 CURRENT_PASSWORD_INVALID', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      payload: {
        currentPassword: 'not-the-right-one',
        newPassword: 'another-strong-password-123!',
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.CURRENT_PASSWORD_INVALID);
  });
});
