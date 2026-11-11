import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, registryLookupResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { fakeNip } from '../../helpers/fake-registry-clients.js';
import {
  REGISTER_URL,
  configureGusCredential,
  enableRegistryLookup,
  flushRegistryLookupRedis,
  lookup,
  registrationBody,
  registryFakes,
  resetRegistryLookup,
} from '../../helpers/registry-lookup.js';

/**
 * `specs/176-command-hooks-outbox/` T007 (FR-001, FR-003, FR-006, SC-001; US1
 * scenarios 1–3) — a registration happens completely or not at all [real DB].
 *
 * Registration writes five tables: the Organization, its sales-channel binding,
 * the first account, the registry-lookup validation row and the e-mail
 * verification token. A fault is injected at each write by a trigger that fires
 * only for an Organization whose name carries the step's marker, so nothing
 * else this database serves is touched. After every fault, none of the five
 * tables holds a row of that registration, no audit entry carries its request
 * id, and neither of its events was dispatched. The account step raises
 * `unique_violation`, which is what a racing registration of the same e-mail
 * looks like to the losing insert: the pre-check cannot see it, the unique
 * index answers.
 *
 * A clean registration writes one `organization.register` entry and one
 * `customer_account.create` entry, both carrying the request's id, and
 * dispatches each event once.
 */

const FAULT_FUNCTION = 'test_176_registration_fault';
const TRIGGERS: ReadonlyArray<{ table: string; marker: string; kind: 'fault' | 'unique' }> = [
  { table: 'organizations', marker: 'FAULT-ORG', kind: 'fault' },
  { table: 'sales_channel_organizations', marker: 'FAULT-CHANNEL', kind: 'fault' },
  { table: 'customer_accounts', marker: 'FAULT-ACCOUNT', kind: 'unique' },
  { table: 'organization_tax_id_validations', marker: 'FAULT-LOOKUP', kind: 'fault' },
  { table: 'email_verification_tokens', marker: 'FAULT-TOKEN', kind: 'fault' },
];

interface Probe {
  requestId: string;
  taxId: string;
  email: string;
  since: Date;
}

describe('registration is one transaction (176 T007)', () => {
  let h: BackendServerHandle;
  let seed = 41_760_000;
  const nip = (): string => fakeNip((seed += 7), '6');
  const registered: Array<{ organizationId: string }> = [];
  const accountsCreated: Array<{ organizationId: string; customerAccountId: string }> = [];

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64');
    h = await setupBackendServer();
    const conn = h.orm.em.getConnection();
    await conn.execute(`
      create or replace function "${FAULT_FUNCTION}"() returns trigger language plpgsql as $fn$
      declare
        org_id uuid;
      begin
        if TG_TABLE_NAME = 'organizations' then
          org_id := NEW.id;
          if NEW.name not like TG_ARGV[0] || '%' then return NEW; end if;
        else
          if TG_TABLE_NAME = 'email_verification_tokens' then
            select ca.organization_id into org_id from customer_accounts ca where ca.id = NEW.customer_account_id;
          else
            org_id := NEW.organization_id;
          end if;
          if not exists (select 1 from organizations o where o.id = org_id and o.name like TG_ARGV[0] || '%') then
            return NEW;
          end if;
        end if;
        if TG_ARGV[1] = 'unique' then
          raise unique_violation using message = 'injected: a racing registration took this e-mail';
        end if;
        raise exception 'injected fault at %', TG_TABLE_NAME;
      end
      $fn$`);
    for (const { table, marker, kind } of TRIGGERS) {
      await conn.execute(
        `create trigger "${FAULT_FUNCTION}_${table}" before insert on "${table}"
           for each row execute function "${FAULT_FUNCTION}"('${marker}', '${kind}')`,
      );
    }
    h.eventBus.on('organization.registered.v1', (payload) => {
      registered.push(payload as unknown as { organizationId: string });
    });
    h.eventBus.on('customer_account.created.v1', (payload) => {
      accountsCreated.push(payload as unknown as { organizationId: string; customerAccountId: string });
    });
    await enableRegistryLookup(h, 'gus_mf');
    await configureGusCredential(h);
  }, 120_000);

  afterAll(async () => {
    const conn = h.orm.em.getConnection();
    for (const { table } of TRIGGERS) {
      await conn.execute(`drop trigger if exists "${FAULT_FUNCTION}_${table}" on "${table}"`);
    }
    await conn.execute(`drop function if exists "${FAULT_FUNCTION}"()`);
    await resetRegistryLookup(h);
    await flushRegistryLookupRedis(h);
    await teardownBackendServer(h);
  });

  async function lookupTicket(taxId: string): Promise<string> {
    registryFakes(h).reset();
    const res = await lookup(h, taxId);
    expect(res.statusCode, res.body).toBe(200);
    return registryLookupResponseSchema.parse(res.json()).data.lookupId!;
  }

  async function register(marker: string): Promise<{ status: number; body: string; probe: Probe }> {
    const taxId = nip();
    const body = registrationBody(taxId, { registryLookupId: await lookupTicket(taxId) });
    const organization = body['organization'] as { name: string };
    organization.name = `${marker} ${organization.name}`;
    const probe: Probe = {
      requestId: `t176-${randomUUID()}`,
      taxId,
      email: (body['firstUser'] as { email: string }).email,
      since: new Date(Date.now() - 1_000),
    };
    const res = await h.app.inject({
      method: 'POST',
      url: REGISTER_URL,
      headers: { 'x-request-id': probe.requestId },
      payload: body,
    });
    return { status: res.statusCode, body: res.body, probe };
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const rows = (await h.orm.em.getConnection().execute(sql, params)) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  /** Every row the registration could have left, and every audit entry it could have written. */
  async function residue(probe: Probe): Promise<Record<string, number>> {
    return {
      organizations: await count(`select count(*)::int as n from "organizations" where "tax_id" = ?`, [probe.taxId]),
      salesChannelBindings: await count(
        `select count(*)::int as n from "sales_channel_organizations" s
           join "organizations" o on o."id" = s."organization_id" where o."tax_id" = ?`,
        [probe.taxId],
      ),
      customerAccounts: await count(`select count(*)::int as n from "customer_accounts" where "email" = ?`, [
        probe.email,
      ]),
      validationRows: await count(
        `select count(*)::int as n from "organization_tax_id_validations" where "tax_id_value" = ?`,
        [probe.taxId],
      ),
      verificationTokens: await count(
        `select count(*)::int as n from "email_verification_tokens" t
           join "customer_accounts" ca on ca."id" = t."customer_account_id" where ca."email" = ?`,
        [probe.email],
      ),
      // By request id, and — since an entry written outside the bus carried
      // none — any registration entry since the call whose object is gone.
      auditByRequest: await count(`select count(*)::int as n from "audit_log_entries" where "request_id" = ?`, [
        probe.requestId,
      ]),
      orphanAudit: await count(
        `select count(*)::int as n from "audit_log_entries" a
          where a."acted_at" >= ?
            and ((a."action" = 'organization.register'
                  and not exists (select 1 from "organizations" o where o."id"::text = a."object_id"))
              or (a."action" = 'customer_account.create'
                  and not exists (select 1 from "customer_accounts" ca where ca."id"::text = a."object_id")))`,
        [probe.since],
      ),
    };
  }

  const NOTHING = {
    organizations: 0,
    salesChannelBindings: 0,
    customerAccounts: 0,
    validationRows: 0,
    verificationTokens: 0,
    auditByRequest: 0,
    orphanAudit: 0,
  };

  it.each([
    ['the Organization insert', 'FAULT-ORG', 500],
    ['the sales-channel binding', 'FAULT-CHANNEL', 500],
    ['the account insert (a racing e-mail)', 'FAULT-ACCOUNT', 409],
    ['the registry-lookup validation row', 'FAULT-LOOKUP', 500],
    ['the verification token', 'FAULT-TOKEN', 500],
  ])('a fault at %s leaves nothing behind', async (_step, marker, status) => {
    const eventsBefore = { registered: registered.length, accounts: accountsCreated.length };
    const { status: answered, body, probe } = await register(marker as string);
    expect(answered, body).toBe(status);
    if (status === 409) {
      expect(JSON.parse(body)).toMatchObject({ error: { code: ERROR_CODES.EMAIL_ALREADY_REGISTERED } });
    }
    expect(await residue(probe)).toEqual(NOTHING);
    expect({ registered: registered.length, accounts: accountsCreated.length }).toEqual(eventsBefore);
  });

  it('a clean registration writes every row, two entries under one request id, and each event once', async () => {
    const { status, body, probe } = await register('CLEAN');
    expect(status, body).toBe(201);
    const organizationId = (JSON.parse(body) as { data: { organization: { id: string } } }).data.organization.id;
    expect(await residue(probe)).toEqual({
      organizations: 1,
      salesChannelBindings: 1,
      customerAccounts: 1,
      validationRows: 1,
      verificationTokens: 1,
      auditByRequest: expect.any(Number),
      orphanAudit: 0,
    });
    const entries = (await h.orm.em
      .getConnection()
      .execute(`select "action", "object_id" from "audit_log_entries" where "request_id" = ? order by "action"`, [
        probe.requestId,
      ])) as Array<{ action: string; object_id: string }>;
    expect(entries.filter((e) => e.action === 'organization.register' || e.action === 'customer_account.create')).toEqual([
      { action: 'customer_account.create', object_id: expect.any(String) },
      { action: 'organization.register', object_id: organizationId },
    ]);
    expect(registered.filter((e) => e.organizationId === organizationId)).toHaveLength(1);
    expect(accountsCreated.filter((e) => e.organizationId === organizationId)).toHaveLength(1);
  });
});
