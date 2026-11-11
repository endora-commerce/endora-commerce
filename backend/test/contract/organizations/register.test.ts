import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
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

  // `specs/177-tax-id-scope/` FR-024 — the pre-check goes through
  // `resolveByTaxId`, which normalises its input (whitespace and dashes
  // stripped, upper-cased): the same tax ID typed differently is the same one.
  it('refuses a tax ID that differs from an existing one only in case, spaces and dashes', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        ...payload,
        organization: { ...payload.organization, taxId: 'pl 1234-567-890' },
        firstUser: { ...payload.firstUser, email: 'normalised-duplicate@example.com' },
      },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
  });

  // `specs/177-tax-id-scope/` review finding 5 — normalised first, then held to
  // 8 to 32 characters: dashes alone and an over-long value are refused with 400.
  it.each(['--------', '  - -  - -', '1'.repeat(33)])('refuses the tax ID %j once normalised', async (taxId) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        ...payload,
        organization: { ...payload.organization, taxId },
        firstUser: { ...payload.firstUser, email: 'normalised-length@example.com' },
      },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  // `specs/177-tax-id-scope/` T041d (D-290 / OD-11) — stored, and echoed, normalised.
  it('stores and answers the normalised tax ID', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        ...payload,
        organization: { ...payload.organization, taxId: 'pl 526-025-09-95' },
        firstUser: { ...payload.firstUser, email: 'normalised-store@example.com' },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { organization: { id: string; taxId: string } } };
    expect(body.data.organization.taxId).toBe('PL5260250995');
    const [row] = (await h.em().execute('select "tax_id" from "organizations" where "id" = ?', [
      body.data.organization.id,
    ])) as [{ tax_id: string }];
    expect(row.tax_id).toBe('PL5260250995');
  });
});
