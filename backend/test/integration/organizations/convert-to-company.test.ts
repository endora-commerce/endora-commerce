import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomerAccountReadPort,
  type OrganizationConvertToCompanyInput,
  type TaxIdScope,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { makeConvertToCompanyCommand } from '../../../../packages/modules/organizations/src/backend/commands/convert-to-company.command.js';
import { makeSetTaxIdScopeCommand } from '../../../../packages/modules/organizations/src/backend/commands/set-tax-id-scope.command.js';
import { TaxIdScopeService } from '../../../../packages/modules/organizations/src/backend/services/tax-id-scope-service.js';
import { runOrganizationWrite, taxIdExistsRefusal } from '../../../../packages/modules/organizations/src/backend/services/organization-write.js';

/**
 * `specs/177-tax-id-scope/` T050 — `organization.convert_to_company`
 * (`contracts/convert-to-company.md` §1; FR-030, FR-032 … FR-037, FR-039,
 * FR-051), through the real bus against the database, in either scope.
 */
describe('organization.convert_to_company', () => {
  let h: BackendServerHandle;
  let initialScope: TaxIdScope;
  const shared: string[] = [];

  const cradle = () =>
    h.container.cradle as unknown as {
      commandBus: { run<T>(command: Command<T>): Promise<T> };
      customerAccountReadPort: CustomerAccountReadPort;
    };

  async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T> {
    return h.em().fork().getConnection().execute(statement, params) as Promise<T>;
  }

  const uniqueTaxId = (): string => `CV${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;

  const input = (over: Partial<OrganizationConvertToCompanyInput> = {}): OrganizationConvertToCompanyInput => ({
    name: 'Kowalski Usługi',
    legalName: 'Kowalski Usługi Sp. z o.o.',
    taxId: uniqueTaxId(),
    registeredAddress: { street: 'ul. Firmowa 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
    vatStatus: 'vat_payer',
    ...over,
  });

  const command = (organizationId: string, body: OrganizationConvertToCompanyInput) =>
    makeConvertToCompanyCommand({ accounts: cradle().customerAccountReadPort }, { organizationId, input: body });

  const convert = (organizationId: string, body: OrganizationConvertToCompanyInput) =>
    runOrganizationWrite(cradle().commandBus, command(organizationId, body), () => taxIdExistsRefusal());

  /** A personal organization with its one member, as provisioning leaves it. */
  async function personal(options: { approved?: boolean; deleted?: boolean } = {}): Promise<{ id: string; accountId: string }> {
    const id = randomUUID();
    const accountId = randomUUID();
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path",
          "approved_at","deleted_at","created_at","updated_at")
       values (?, 'Jan Kowalski', null, 'active', 'vat_exempt', true, ?, '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::jsonb, ?,
               ?, ?, now(), now())`,
      [id, accountId, `/${id}/`, options.approved ? '2026-01-01T00:00:00Z' : null, options.deleted ? new Date() : null],
    );
    await sql(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Jan', 'Kowalski', now(), now())`,
      [accountId, id, `${accountId.slice(0, 8)}@convert.example`],
    );
    return { id, accountId };
  }

  async function row(id: string) {
    const [found] = await sql<
      Array<{
        id: string;
        is_personal: boolean;
        tax_id: string | null;
        name: string;
        legal_name: string | null;
        vat_status: string;
        status: string;
        personal_account_id: string | null;
        converted_to_company_at: Date | null;
        approved_at: Date | null;
        approved_by_admin_user_id: string | null;
        registered_address: { city: string };
      }>
    >('select * from "organizations" where "id" = ?', [id]);
    return found!;
  }

  const setScope = (scope: TaxIdScope) =>
    cradle().commandBus.run(
      makeSetTaxIdScopeCommand({ scopes: new TaxIdScopeService(() => h.em().fork() as EntityManager) }, { scope }),
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    initialScope = await new TaxIdScopeService(() => h.em().fork() as EntityManager).scope();
  });

  afterEach(async () => {
    if (shared.length > 0) {
      await sql(
        `update "organizations" set "tax_id" = 'R' || upper(substr(replace("id"::text, '-', ''), 1, 31))
          where "id" = any(?::uuid[])`,
        [`{${shared.join(',')}}`],
      );
      shared.length = 0;
    }
    if ((await new TaxIdScopeService(() => h.em().fork() as EntityManager).scope()) !== initialScope) {
      await setScope(initialScope);
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('turns the personal organization into a company, keeping its id and status', async () => {
    const org = await personal();
    const body = input({ taxId: 'pl 526-025-11-77' });

    const result = await convert(org.id, body);

    expect(result.id).toBe(org.id);
    const after = await row(org.id);
    expect(after).toMatchObject({
      is_personal: false,
      tax_id: 'PL5260251177',
      name: body.name,
      legal_name: body.legalName,
      vat_status: 'vat_payer',
      status: 'active',
      personal_account_id: null,
    });
    expect(after.registered_address.city).toBe('Gdańsk');
    expect(after.converted_to_company_at).not.toBeNull();
    // Approved by the converting operator when it never was.
    expect(after.approved_at).not.toBeNull();
    // Cleared for the next test's global constraint.
    shared.push(org.id);
  });

  it('keeps an approval stamp that is already there', async () => {
    const org = await personal({ approved: true });
    await convert(org.id, input());
    expect(new Date((await row(org.id)).approved_at!).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('leaves both predefined roles and the member as their Administrator', async () => {
    const org = await personal();
    await convert(org.id, input());
    const roles = await sql<Array<{ kind: string }>>(
      'select "kind" from "organization_roles" where "organization_id" = ? and "kind" is not null order by "kind"',
      [org.id],
    );
    expect(roles.map((r) => r.kind)).toEqual(['administrator', 'member']);
    const [member] = await sql<Array<{ kind: string }>>(
      `select r."kind" from "customer_accounts" a join "organization_roles" r on r."id" = a."organization_role_id"
        where a."id" = ?`,
      [org.accountId],
    );
    expect(member!.kind).toBe('administrator');
  });

  it('refuses a company, a deleted organization and a member who is not the Administrator', async () => {
    const company = await personal();
    await convert(company.id, input());
    await expect(convert(company.id, input())).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ORGANIZATION_CONVERSION_REFUSED,
      details: { code: 'not_personal' },
    });

    const deleted = await personal({ deleted: true });
    await expect(convert(deleted.id, input())).rejects.toMatchObject({
      code: ERROR_CODES.ORGANIZATION_CONVERSION_REFUSED,
      details: { code: 'deleted' },
    });

    const demoted = await personal();
    await sql(
      `update "customer_accounts" set "organization_role_id" =
         (select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'member')
        where "id" = ?`,
      [demoted.id, demoted.accountId],
    );
    await expect(convert(demoted.id, input())).rejects.toMatchObject({
      code: ERROR_CODES.ORGANIZATION_CONVERSION_REFUSED,
      details: { code: 'owner_not_administrator' },
    });
    expect((await row(demoted.id)).is_personal).toBe(true);
  });

  it('answers 404 for an unknown organization', async () => {
    await expect(convert(randomUUID(), input())).rejects.toMatchObject({ statusCode: 404 });
  });

  for (const scope of ['global', 'per-tree-root'] as const) {
    it(`${scope}: refuses a tax ID another tree holds with ORGANIZATION_TAX_ID_EXISTS`, async () => {
      await setScope(scope);
      const holder = await personal();
      const taxId = uniqueTaxId();
      await convert(holder.id, input({ taxId }));
      const other = await personal();
      await expect(convert(other.id, input({ taxId }))).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
      });
      expect((await row(other.id)).is_personal).toBe(true);
    });
  }

  it('rolls everything back, and dispatches no event, when the Command fails after its write', async () => {
    const org = await personal();
    const events: unknown[] = [];
    const off = (h.eventBus as unknown as { on(n: string, f: (p: unknown) => void): () => void }).on(
      'organization.converted_to_company.v1',
      (payload) => events.push(payload),
    );
    const failing: Command<unknown> = {
      ...command(org.id, input()),
      run: async (ctx) => {
        await command(org.id, input()).run(ctx);
        throw new Error('injected after the conversion');
      },
    };
    await expect(cradle().commandBus.run(failing)).rejects.toThrow('injected after the conversion');
    off();
    expect((await row(org.id)).is_personal).toBe(true);
    expect(events).toEqual([]);
  });

  it('dispatches organization.converted_to_company.v1 once, on commit, without names or tax ID', async () => {
    const org = await personal();
    const events: Array<Record<string, unknown>> = [];
    const off = (h.eventBus as unknown as { on(n: string, f: (p: unknown) => void): () => void }).on(
      'organization.converted_to_company.v1',
      (payload) => events.push(payload as Record<string, unknown>),
    );
    await convert(org.id, input());
    off();
    const mine = events.filter((event) => event['organizationId'] === org.id);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]!).sort()).toEqual(['convertedAt', 'eventId', 'occurredAt', 'organizationId']);
  });

  it('audits names only (audit-state.md): changedFields, the approval flag and the scope', async () => {
    const org = await personal();
    const sentinel = 'S177-CONVERT-NAME';
    await convert(org.id, input({ name: sentinel, legalName: `${sentinel} Sp. z o.o.`, taxId: 'PL177S177S177' }));
    const entries = await sql<Array<{ action: string; state_before: unknown; state_after: Record<string, unknown> }>>(
      `select "action", "state_before", "state_after" from "audit_log_entries"
        where "action" = 'organization.convert_to_company' and "object_id" = ?`,
      [org.id],
    );
    expect(entries).toHaveLength(1);
    expectNoAuditValues(
      entries.map((entry) => ({ action: entry.action, stateBefore: entry.state_before as never, stateAfter: entry.state_after as never })),
      [sentinel, 'PL177S177S177', 'Gdańsk', 'Firmowa'],
    );
    expect(entries[0]!.state_before).toEqual({ isPersonal: true });
    expect(entries[0]!.state_after).toMatchObject({
      isPersonal: false,
      changedFields: ['isPersonal', 'legalName', 'name', 'registeredAddress', 'taxId', 'vatStatus'],
      approvalStamped: true,
    });
    expect(['global', 'per-tree-root']).toContain(entries[0]!.state_after['taxIdScope']);
  });
});
