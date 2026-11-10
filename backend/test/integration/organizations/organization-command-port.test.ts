import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationCommandPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * `specs/177-tax-id-scope/` T055 (`contracts/convert-to-company.md` §4) —
 * `organizationCommandPort.convertToCompany` runs the Command with the ambient
 * actor: the administrator inside an admin context, nobody under the system
 * scope. It runs no VAT validation.
 */
describe('organizationCommandPort.convertToCompany', () => {
  let h: BackendServerHandle;
  let port: OrganizationCommandPort;

  async function personal(): Promise<string> {
    const id = randomUUID();
    await h.em().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
       values (?, 'Port Person', null, 'active', 'vat_exempt', true, ?, '{}'::jsonb, ?, now(), now())`,
      [id, randomUUID(), `/${id}/`],
    );
    return id;
  }

  const input = () => ({
    name: 'Port Company',
    taxId: `PT${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    registeredAddress: { street: 'ul. Portowa 3', city: 'Szczecin', postalCode: '70-001', country: 'PL' },
    vatStatus: 'vat_payer' as const,
  });

  async function actorOf(id: string): Promise<string | null> {
    const [row] = (await h.em().execute(
      `select "actor_admin_user_id" from "audit_log_entries" where "action" = 'organization.convert_to_company' and "object_id" = ?`,
      [id],
    )) as [{ actor_admin_user_id: string | null }];
    return row.actor_admin_user_id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<OrganizationCommandPort>('organizationCommandPort');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('runs with the ambient administrator and answers the company record', async () => {
    const id = await personal();
    const admin: TenantContext = { mode: 'all', actor: { kind: 'admin', id: TEST_ADMIN_ID } };
    const record = await runWithTenantContext(admin, () => port.convertToCompany(id, input()));
    expect(record).toMatchObject({ id, isPersonal: false, name: 'Port Company' });
    expect(record.convertedToCompanyAt).toBeInstanceOf(Date);
    expect(await actorOf(id)).toBe(TEST_ADMIN_ID);
  });

  it('runs under the system scope with no actor, and validates nothing', async () => {
    const id = await personal();
    await port.convertToCompany(id, input());
    expect(await actorOf(id)).toBeNull();
    const [{ count }] = (await h.em().execute(
      'select count(*)::int as "count" from "organization_tax_id_validations" where "organization_id" = ?',
      [id],
    )) as [{ count: number }];
    expect(count).toBe(0);
  });
});
