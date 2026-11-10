import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * `specs/177-tax-id-scope/` T052 (FR-031, FR-038, FR-041;
 * `contracts/convert-to-company.md` §3, §7) —
 * `POST /api/v1/admin/organizations/:id/convert-to-company`.
 */
describe('POST /api/v1/admin/organizations/:id/convert-to-company', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-8);
  const WITHOUT = `stub-convert-without-${stamp}`;
  const CONVERTER = `stub-convert-with-${stamp}`;
  let seq = 0;

  const body = (over: Record<string, unknown> = {}) => ({
    name: 'Nowak Handel',
    taxId: `CR${stamp}${String(seq++).padStart(3, '0')}`,
    registeredAddress: { street: 'ul. Handlowa 2', city: 'Poznań', postalCode: '60-001', country: 'PL' },
    ...over,
  });

  const convert = (id: string, payload: object, session = 'stub-admin-session') =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${id}/convert-to-company`,
      cookies: { b2b_session: session },
      payload,
    });

  async function personal(): Promise<string> {
    const id = randomUUID();
    const accountId = randomUUID();
    await h.em().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
       values (?, 'Anna Nowak', null, 'active', 'vat_exempt', true, ?, '{}'::jsonb, ?, now(), now())`,
      [id, accountId, `/${id}/`],
    );
    await h.em().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Anna', 'Nowak', now(), now())`,
      [accountId, id, `${accountId.slice(0, 8)}@convert-route.example`],
    );
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const user = async (label: string, permissions: string[]) => {
      const role = em.create(AdminRole, { code: `convert_${label}_${stamp}`, name: `convert ${label}`, permissions });
      await em.persistAndFlush(role);
      const account = em.create(AdminUser, {
        email: `convert-${label}-${stamp}@example.test`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Convert',
        lastName: label,
        adminRoleId: role.id,
      });
      await em.persistAndFlush(account);
      return account.id;
    };
    ADMIN_COOKIES[WITHOUT] = { adminUserId: await user('without', ['customers:read', 'customers:manage']) };
    ADMIN_COOKIES[CONVERTER] = {
      adminUserId: await user('with', ['customers:read', 'organizations:convert-to-company']),
    };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[WITHOUT];
    delete ADMIN_COOKIES[CONVERTER];
    await teardownBackendServer(h);
  });

  it('is refused 403 without organizations:convert-to-company, and 401 without a session', async () => {
    const id = await personal();
    expect((await convert(id, body(), WITHOUT)).statusCode).toBe(403);
    const anonymous = await h.app.inject({ method: 'POST', url: `/api/v1/admin/organizations/${id}/convert-to-company`, payload: body() });
    expect(anonymous.statusCode).toBe(401);
  });

  it('answers 404 for an organization that does not exist', async () => {
    const res = await convert(randomUUID(), body());
    expect(res.statusCode).toBe(404);
  });

  it('converts, answers the company, and opens role management for it', async () => {
    const id = await personal();
    const before = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${id}/roles`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(before.statusCode).toBe(404);

    const res = await convert(id, body({ taxId: 'cr-177 000 001' }), CONVERTER);
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Record<string, unknown>; vatValidation: unknown }).data;
    expect(data).toMatchObject({ id, isPersonal: false, taxId: 'CR177000001', name: 'Nowak Handel', status: 'active' });
    expect((res.json() as { vatValidation: unknown }).vatValidation).toBeNull();

    const after = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${id}/roles`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(after.statusCode, after.body).toBe(200);
  });

  it('runs a VAT validation after the commit when asked, and keeps the conversion whatever it answers', async () => {
    const id = await personal();
    const res = await convert(id, body({ validateTaxId: true }));
    expect(res.statusCode, res.body).toBe(200);
    const vat = (res.json() as { vatValidation: { outcome: string } | null }).vatValidation;
    expect(vat).not.toBeNull();
    expect(typeof vat!.outcome).toBe('string');
    const [row] = (await h.em().execute('select "is_personal" from "organizations" where "id" = ?', [id])) as [
      { is_personal: boolean },
    ];
    expect(row.is_personal).toBe(false);
  });

  it('answers the refusals with their codes', async () => {
    const id = await personal();
    const taxId = `CR${stamp}DUP`;
    expect((await convert(id, body({ taxId }))).statusCode).toBe(200);
    const again = await convert(id, body());
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({
      code: ERROR_CODES.ORGANIZATION_CONVERSION_REFUSED,
      details: { code: 'not_personal' },
    });
    const other = await personal();
    const duplicate = await convert(other, body({ taxId }));
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
  });

  it('validates the body', async () => {
    const id = await personal();
    for (const payload of [body({ name: '' }), body({ taxId: '1' }), body({ registeredAddress: { street: 'x' } })]) {
      expect((await convert(id, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('has no reverse: no route or action converts a company back (FR-041)', async () => {
    const document = (
      await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json', cookies: { b2b_session: 'stub-admin-session' } })
    ).json() as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths).filter((path) => /convert-to-personal|to-personal/.test(path))).toEqual([]);
    expect(Object.keys(document.paths)).toContain('/api/v1/admin/organizations/{id}/convert-to-company');
  });
});
