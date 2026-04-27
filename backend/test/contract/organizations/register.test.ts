import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T094 — `POST /organizations/register` must reject a duplicate `taxId` with
 * 409 ORGANIZATION_TAX_ID_EXISTS and MUST NOT create a second Organization row.
 * (contracts/organizations.contract.md)
 */

describe('POST /api/v1/organizations/register — duplicate taxId', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const payload = {
    organization: {
      name: 'Acme Sp. z o.o.',
      taxId: 'PL1234567890',
      registeredAddress: {
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
    },
    firstUser: {
      email: 'first-admin@example.com',
      password: 'a-very-strong-password-123!',
      firstName: 'Anna',
      lastName: 'Nowak',
    },
    acceptedTermsVersion: '1.0.0',
  };

  it('first registration succeeds (201) then second with same taxId returns 409', async () => {
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        ...payload,
        firstUser: { ...payload.firstUser, email: 'other@example.com' },
      },
    });
    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
  });
});
