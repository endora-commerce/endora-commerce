import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/176-command-hooks-outbox/` T008 (FR-008, US1 scenario 5) — the public
 * registration contract is unchanged by registration becoming one Command.
 *
 * The shapes below were recorded against `master` before the change (the
 * pre-change fixtures): the 201 body's key structure with each value's type,
 * and the status and error code of each refusal. The tax-ID race is answered by
 * the database's own constraint — `global`'s unique index at the statement, or
 * `per-tree-root`'s deferred exclusion constraint at commit — and must still be
 * the pre-check's `409 ORGANIZATION_TAX_ID_EXISTS`, never a 500. Run it in both
 * scopes (`ORGANIZATIONS_TAX_ID_SCOPE=per-tree-root` for the second).
 */

const REGISTER_URL = '/api/v1/organizations/register';

let seq = 0;
function registration(overrides: { taxId?: string; email?: string } = {}): Record<string, unknown> {
  seq += 1;
  const stamp = `${Date.now()}${seq}`.slice(-10);
  return {
    organization: {
      name: `Unchanged ${stamp}`,
      taxId: overrides.taxId ?? `PL${stamp}`,
      registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    },
    firstUser: {
      email: overrides.email ?? `unchanged-${stamp}@example.test`,
      password: 'a-very-strong-password-123!',
      firstName: 'Anna',
      lastName: 'Nowak',
    },
    acceptedTermsVersion: '1.0.0',
  };
}

/** Every value replaced by its type name, recursively — the shape, not the data. */
function shapeOf(value: unknown): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? 'array' : [shapeOf(value[0])];
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, shapeOf((value as Record<string, unknown>)[key])]),
    );
  }
  return typeof value;
}

describe('POST /api/v1/organizations/register — the contract is unchanged (176 T008)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function register(body: Record<string, unknown>) {
    return h.app.inject({ method: 'POST', url: REGISTER_URL, payload: body });
  }

  async function organizationsWithTaxId(taxId: string): Promise<number> {
    const rows = (await h.em().execute(`select count(*)::int as n from "organizations" where "tax_id" = ?`, [
      taxId,
    ])) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  it('201 answers the pre-change body shape', async () => {
    const res = await register(registration());
    expect(res.statusCode, res.body).toBe(201);
    expect(shapeOf(res.json())).toMatchInlineSnapshot(`
      {
        "data": {
          "customerAccount": {
            "createdAt": "string",
            "email": "string",
            "emailVerifiedAt": "null",
            "firstName": "string",
            "id": "string",
            "lastName": "string",
            "organizationId": "string",
            "organizationRole": {
              "id": "string",
              "kind": "string",
              "name": "string",
            },
            "permissions": [
              "string",
            ],
            "twoFactorEnabled": "boolean",
            "updatedAt": "string",
          },
          "emailVerificationSent": "boolean",
          "organization": {
            "createdAt": "string",
            "id": "string",
            "name": "string",
            "registeredAddress": {
              "city": "string",
              "country": "string",
              "postalCode": "string",
              "street": "string",
            },
            "status": "string",
            "taxId": "string",
            "updatedAt": "string",
            "vatStatus": "string",
          },
        },
      }
    `);
  });

  it('409 ORGANIZATION_TAX_ID_EXISTS from the pre-check', async () => {
    const first = registration();
    expect((await register(first)).statusCode).toBe(201);
    const taxId = (first['organization'] as { taxId: string }).taxId;
    const res = await register(registration({ taxId }));
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS } });
  });

  it('409 EMAIL_ALREADY_REGISTERED, and no Organization with the submitted tax ID', async () => {
    const first = registration();
    expect((await register(first)).statusCode).toBe(201);
    const email = (first['firstUser'] as { email: string }).email;
    const second = registration({ email });
    const res = await register(second);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.EMAIL_ALREADY_REGISTERED } });
    expect(await organizationsWithTaxId((second['organization'] as { taxId: string }).taxId)).toBe(0);
  });

  it('422 CUSTOM_FIELD_VALUE_INVALID for a value not open on registration', async () => {
    const body = registration();
    (body['organization'] as Record<string, unknown>)['customFieldValues'] = { not_a_field: 'x' };
    const res = await register(body);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID } });
  });

  it('a malformed body keeps its pre-change status and code', async () => {
    const res = await register({ organization: { name: 'x' } });
    expect({ status: res.statusCode, code: (res.json() as { error: { code: string } }).error.code }).toMatchInlineSnapshot(`
      {
        "code": "VALIDATION_FAILED",
        "status": 400,
      }
    `);
  });

  it('a tax-ID race is answered 409 ORGANIZATION_TAX_ID_EXISTS by the constraint, never 500', async () => {
    const taxId = `PL${`${Date.now()}`.slice(-9)}7`;
    const answers = await Promise.all([register(registration({ taxId })), register(registration({ taxId }))]);
    const statuses = answers.map((res) => res.statusCode).sort();
    expect(statuses, answers.map((res) => res.body).join('\n')).toEqual([201, 409]);
    const refused = answers.find((res) => res.statusCode === 409)!;
    expect(refused.json()).toMatchObject({ error: { code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS } });
    expect(await organizationsWithTaxId(taxId)).toBe(1);
  });
});
