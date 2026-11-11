import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { TaxIdScopeService } from '../../../../packages/modules/organizations/src/backend/services/tax-id-scope-service.js';

/**
 * Issue #1040 — `POST /api/v1/admin/organizations/:id/change-tax-id`: the gate,
 * the reach, the refusals, the conflict in the scope the suite runs in (CI runs
 * this tree in both, FR-027), the same-value answer, the VAT validation after
 * commit, and a names-only row on the global audit log.
 */
describe('POST /api/v1/admin/organizations/:id/change-tax-id', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-8);
  const WITHOUT = `stub-change-tax-id-without-${stamp}`;
  const CHANGER = `stub-change-tax-id-with-${stamp}`;
  let seq = 0;

  const taxId = (): string => `CT${stamp}${String(seq++).padStart(4, '0')}`;

  const changeTaxId = (id: string, payload: object, session = 'stub-admin-session') =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${id}/change-tax-id`,
      cookies: { b2b_session: session },
      payload,
    });

  async function company(options: { deleted?: boolean; parentId?: string; taxId?: string } = {}): Promise<{ id: string; taxId: string }> {
    const id = randomUUID();
    const value = options.taxId ?? taxId();
    const path = options.parentId ? `/${options.parentId}/${id}/` : `/${id}/`;
    await h.em().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","parent_id",
          "vat_validated_at","vat_validation_provider","vat_validation_outcome","deleted_at","created_at","updated_at")
       values (?, 'S1040-NAME', ?, 'active', 'vat_payer', false, '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::jsonb, ?, ?,
               now(), 'mf_pl', 'validated', ?, now(), now())`,
      [id, value, path, options.parentId ?? null, options.deleted ? new Date() : null],
    );
    return { id, taxId: value };
  }

  async function stored(id: string): Promise<{ tax_id: string; vat_validation_outcome: string | null }> {
    const [row] = (await h.em().execute('select "tax_id", "vat_validation_outcome" from "organizations" where "id" = ?', [id])) as [
      { tax_id: string; vat_validation_outcome: string | null },
    ];
    return row;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const user = async (label: string, permissions: string[]) => {
      const role = em.create(AdminRole, { code: `change_tax_id_${label}_${stamp}`, name: `change tax id ${label}`, permissions });
      await em.persistAndFlush(role);
      const account = em.create(AdminUser, {
        email: `change-tax-id-${label}-${stamp}@example.test`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Change',
        lastName: label,
        adminRoleId: role.id,
      });
      await em.persistAndFlush(account);
      return account.id;
    };
    ADMIN_COOKIES[WITHOUT] = { adminUserId: await user('without', ['customers:read', 'customers:manage']) };
    ADMIN_COOKIES[CHANGER] = { adminUserId: await user('with', ['customers:read', 'organizations:change-tax-id']) };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[WITHOUT];
    delete ADMIN_COOKIES[CHANGER];
    await teardownBackendServer(h);
  });

  it('is refused 403 without organizations:change-tax-id, and 401 without a session', async () => {
    const org = await company();
    expect((await changeTaxId(org.id, { taxId: taxId() }, WITHOUT)).statusCode).toBe(403);
    const anonymous = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${org.id}/change-tax-id`,
      payload: { taxId: taxId() },
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await stored(org.id)).tax_id).toBe(org.taxId);
  });

  it('answers 404 for an unknown, a malformed and a soft-deleted organization', async () => {
    const deleted = await company({ deleted: true });
    for (const id of [randomUUID(), 'not-a-uuid', deleted.id]) {
      expect((await changeTaxId(id, { taxId: taxId() })).statusCode, id).toBe(404);
    }
    expect((await stored(deleted.id)).tax_id).toBe(deleted.taxId);
  });

  it('refuses a personal organization with ORGANIZATION_TAX_ID_CHANGE_REFUSED not_company', async () => {
    const id = randomUUID();
    await h.em().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
       values (?, 'Anna Nowak', null, 'active', 'vat_exempt', true, ?, '{}'::jsonb, ?, now(), now())`,
      [id, randomUUID(), `/${id}/`],
    );
    const res = await changeTaxId(id, { taxId: taxId() });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toMatchObject({
      code: ERROR_CODES.ORGANIZATION_TAX_ID_CHANGE_REFUSED,
      details: { code: 'not_company' },
    });
  });

  it('changes the tax ID under the code alone, normalised, and resets the VAT validation', async () => {
    const org = await company();
    const res = await changeTaxId(org.id, { taxId: 'ct-1040 000 001' }, CHANGER);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: Record<string, unknown>; changed: boolean; vatValidation: unknown };
    expect(body).toMatchObject({ changed: true, vatValidation: null });
    expect(body.data).toMatchObject({ id: org.id, taxId: 'CT1040000001', isPersonal: false });
    expect(await stored(org.id)).toEqual({ tax_id: 'CT1040000001', vat_validation_outcome: null });
  });

  it('answers changed: false and audits nothing for the same value after normalisation', async () => {
    const org = await company();
    const res = await changeTaxId(org.id, { taxId: `${org.taxId.slice(0, 4).toLowerCase()}-${org.taxId.slice(4)}` });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { changed: boolean }).changed).toBe(false);
    expect((await stored(org.id)).vat_validation_outcome).toBe('validated');
    const audits = (await h.em().execute(
      `select 1 from "audit_log_entries" where "action" = 'organization.tax_id.change' and "object_id" = ?`,
      [org.id],
    )) as unknown[];
    expect(audits).toEqual([]);
  });

  it('refuses a tax ID held by another tree, a soft-deleted holder included, in the active scope', async () => {
    const scope = await new TaxIdScopeService(() => h.em().fork() as EntityManager).scope();
    const org = await company();
    for (const holder of [await company(), await company({ deleted: true })]) {
      const res = await changeTaxId(org.id, { taxId: holder.taxId });
      expect(res.statusCode, `${scope}: ${res.body}`).toBe(409);
      expect(res.json().error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
    }
    expect((await stored(org.id)).tax_id).toBe(org.taxId);
  });

  it('refuses validateTaxId without customers:manage and changes nothing', async () => {
    const org = await company();
    const res = await changeTaxId(org.id, { taxId: taxId(), validateTaxId: true }, CHANGER);
    expect(res.statusCode, res.body).toBe(403);
    expect((await stored(org.id)).tax_id).toBe(org.taxId);
  });

  it('runs a VAT validation after the commit when asked, and keeps the change whatever it answers', async () => {
    const org = await company();
    const next = taxId();
    const res = await changeTaxId(org.id, { taxId: next, validateTaxId: true });
    expect(res.statusCode, res.body).toBe(200);
    const vat = (res.json() as { vatValidation: { outcome: string } | null }).vatValidation;
    expect(vat).not.toBeNull();
    expect(typeof vat!.outcome).toBe('string');
    expect((await stored(org.id)).tax_id).toBe(next);
  });

  it('validates the body', async () => {
    const org = await company();
    for (const payload of [{}, { taxId: '1' }, { taxId: '--------' }, { taxId: 'X'.repeat(33) }]) {
      expect((await changeTaxId(org.id, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('leaves the global audit log names only — no tax ID, name or tenant id in its row', async () => {
    const org = await company();
    const next = 'CTS1040S1040S';
    expect((await changeTaxId(org.id, { taxId: next })).statusCode).toBe(200);
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${org.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const rows = (response.json() as {
      data: Array<{ action: string; stateBefore: Record<string, unknown> | null; stateAfter: Record<string, unknown> | null }>;
    }).data.filter((row) => row.action === 'organization.tax_id.change');
    expect(rows).toHaveLength(1);
    const states = JSON.stringify(rows.map((row) => [row.stateBefore, row.stateAfter]));
    for (const sentinel of [org.taxId, next, 'S1040']) expect(states, sentinel).not.toContain(sentinel);
    expect(rows[0]!.stateAfter).toMatchObject({ changedFields: ['taxId'], vatStatusReset: true });
  });
});
