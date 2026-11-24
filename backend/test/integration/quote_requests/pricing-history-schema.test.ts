import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CustomerAccount,
  Organization,
  QuoteRequest,
  QuoteRequestAccountPolicy,
  QuoteRequestOrgPolicy,
} from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * Feature 146, Phase 3 (T011) — the schema of the two migrations
 * (`item_reference_price`, `negotiation_policies`) and the tenant
 * classification of the two policy tables (plan I1, threat model C1).
 *
 * Every tenant assertion runs inside `runWithTenantContext(…)`: the suite's
 * global setup enters `mode: 'system'` before each test, under which every
 * read passes and proves nothing (the trap `org-scoped-write-refusal.test.ts`
 * names). Every "unreadable" case has a "readable" twin, so a read that
 * refuses everybody cannot pass on its own.
 */
describe('146 — quote request pricing/history schema [integration]', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();

  /** Organization A holds the account under test, its colleague and the rep's assignment. */
  let orgA: string;
  /** Organization B is the stranger. */
  let orgB: string;
  let accountA: string;
  let colleagueA: string;
  let accountB: string;

  const newOrganization = (em: EntityManager, suffix: string): Organization =>
    em.create(Organization, {
      name: `146 schema org ${suffix}`,
      taxId: `PL146${suffix}${String(stamp).slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
    });

  const newAccount = (em: EntityManager, organizationId: string, key: string): CustomerAccount =>
    em.create(CustomerAccount, {
      organizationId,
      email: `146-schema-${key}-${stamp}@audit.local`,
      passwordHash: 'x'.repeat(60),
      firstName: '146',
      lastName: key,
    });

  const sql = async <T extends object>(query: string, params: unknown[] = []): Promise<T[]> =>
    h.em().getConnection().execute<T[]>(query, params);

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('146 T011: seed two tenants for the policy-table probe', async () => {
      const em = h.orm.em.fork();
      const a = newOrganization(em, 'A');
      const b = newOrganization(em, 'B');
      await em.persist([a, b]).flush();
      orgA = a.id;
      orgB = b.id;
      const accA = newAccount(em, orgA, 'a');
      const colA = newAccount(em, orgA, 'colleague');
      const accB = newAccount(em, orgB, 'b');
      await em.persist([accA, colA, accB]).flush();
      accountA = accA.id;
      colleagueA = colA.id;
      accountB = accB.id;

      em.persist(em.create(QuoteRequestOrgPolicy, { organizationId: orgA, priceProposalsAllowed: false }));
      em.persist(
        em.create(QuoteRequestAccountPolicy, { customerAccountId: accountA, priceProposalsAllowed: false }),
      );
      await em.flush();
    });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('quote_request_items reference columns (item_reference_price)', () => {
    it('adds the three nullable columns with the declared types', async () => {
      const cols = await sql<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null; character_maximum_length: number | null }>(
        `select column_name, data_type, is_nullable, numeric_precision, numeric_scale, character_maximum_length
           from information_schema.columns
          where table_name = 'quote_request_items'
            and column_name in ('reference_unit_price', 'reference_currency', 'reference_captured_at')
          order by column_name`,
      );
      expect(cols).toEqual([
        expect.objectContaining({ column_name: 'reference_captured_at', data_type: 'timestamp with time zone', is_nullable: 'YES' }),
        expect.objectContaining({ column_name: 'reference_currency', data_type: 'character varying', is_nullable: 'YES', character_maximum_length: 3 }),
        // Widened to the price book's own type by the four-place unit-price ruling of 2026-10-25.
        expect.objectContaining({ column_name: 'reference_unit_price', data_type: 'numeric', is_nullable: 'YES', numeric_precision: 14, numeric_scale: 4 }),
      ]);
    });

    it('accepts all-or-none and refuses a partial reference', async () => {
      const quoteRequestId = await withSystemScope('146 T011: a quote request to hang item rows on', async () => {
        const em = h.orm.em.fork();
        const rfq = em.create(QuoteRequest, { organizationId: orgA, customerAccountId: accountA });
        await em.persist(rfq).flush();
        return rfq.id;
      });
      const insert = (values: [string | null, string | null, string | null]) =>
        sql(
          `insert into quote_request_items
             (id, quote_request_id, product_id, product_name, quantity, line_currency, created_at, updated_at,
              reference_unit_price, reference_currency, reference_captured_at)
           values (gen_random_uuid(), ?, gen_random_uuid(), 'probe', 1, 'PLN', now(), now(), ?, ?, ?)`,
          [quoteRequestId, ...values],
        );

      await expect(insert([null, null, null])).resolves.toBeDefined();
      await expect(insert(['120.00', 'PLN', new Date().toISOString()])).resolves.toBeDefined();
      for (const partial of [
        ['120.00', null, null],
        ['120.00', 'PLN', null],
        [null, 'PLN', new Date().toISOString()],
        [null, null, new Date().toISOString()],
      ] as Array<[string | null, string | null, string | null]>) {
        await expect(insert(partial)).rejects.toThrow(/quote_request_items_reference_all_or_none/);
      }
    });
  });

  describe('policy tables (negotiation_policies)', () => {
    it('creates both tables with their defaults', async () => {
      const cols = await sql<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>(
        `select table_name, column_name, is_nullable, column_default
           from information_schema.columns
          where table_name in ('quote_request_org_policies', 'quote_request_account_policies')
          order by table_name, column_name`,
      );
      const byKey = new Map(cols.map((c) => [`${c.table_name}.${c.column_name}`, c]));
      expect(byKey.get('quote_request_org_policies.organization_id')?.is_nullable).toBe('NO');
      expect(byKey.get('quote_request_org_policies.price_proposals_allowed')).toMatchObject({ is_nullable: 'NO', column_default: 'true' });
      expect(byKey.get('quote_request_account_policies.customer_account_id')?.is_nullable).toBe('NO');
      expect(byKey.get('quote_request_account_policies.price_proposals_allowed')).toMatchObject({ is_nullable: 'YES', column_default: null });
      for (const table of ['quote_request_org_policies', 'quote_request_account_policies']) {
        expect(byKey.get(`${table}.created_at`)?.column_default).toBe('now()');
        expect(byKey.get(`${table}.updated_at`)?.column_default).toBe('now()');
      }
    });

    it('keys each table by its owner with an on-delete-cascade foreign key', async () => {
      const fks = await sql<{ table_name: string; referenced: string; delete_rule: string }>(
        `select con.conrelid::regclass::text as table_name,
                con.confrelid::regclass::text as referenced,
                case con.confdeltype when 'c' then 'CASCADE' else con.confdeltype::text end as delete_rule
           from pg_constraint con
          where con.contype = 'f'
            and con.conrelid::regclass::text in ('quote_request_org_policies', 'quote_request_account_policies')
          order by 1`,
      );
      expect(fks).toEqual([
        { table_name: 'quote_request_account_policies', referenced: 'customer_accounts', delete_rule: 'CASCADE' },
        { table_name: 'quote_request_org_policies', referenced: 'organizations', delete_rule: 'CASCADE' },
      ]);
    });

    it('cascades the deletion of an owner to its policy row only', async () => {
      const { orgId, accountId } = await withSystemScope('146 T011: a disposable owner for the cascade probe', async () => {
        const em = h.orm.em.fork();
        const org = newOrganization(em, 'C');
        await em.persist(org).flush();
        const acc = newAccount(em, orgA, 'cascade');
        await em.persist(acc).flush();
        em.persist(em.create(QuoteRequestOrgPolicy, { organizationId: org.id, priceProposalsAllowed: false }));
        em.persist(em.create(QuoteRequestAccountPolicy, { customerAccountId: acc.id, priceProposalsAllowed: true }));
        await em.flush();
        return { orgId: org.id, accountId: acc.id };
      });
      await sql('delete from customer_accounts where id = ?', [accountId]);
      await sql('delete from organizations where id = ?', [orgId]);

      expect(await sql('select 1 from quote_request_account_policies where customer_account_id = ?', [accountId])).toHaveLength(0);
      expect(await sql('select 1 from quote_request_org_policies where organization_id = ?', [orgId])).toHaveLength(0);
      // The other rows are untouched.
      expect(await sql('select 1 from quote_request_account_policies where customer_account_id = ?', [accountA])).toHaveLength(1);
      expect(await sql('select 1 from quote_request_org_policies where organization_id = ?', [orgA])).toHaveLength(1);
    });
  });

  describe('tenant classification (plan I1, threat model C1)', () => {
    /** An organization administrator of A acting on a colleague's override. */
    const orgAdminA = (): TenantContext => ({
      mode: 'single-org',
      organizationId: orgA,
      customerAccountId: colleagueA,
      actor: { kind: 'customer', id: colleagueA },
    });
    /** A buyer of another organization. */
    const buyerB = (): TenantContext => ({
      mode: 'single-org',
      organizationId: orgB,
      customerAccountId: accountB,
      actor: { kind: 'customer', id: accountB },
    });
    /** A sales representative assigned to A. */
    const repOfA = (): TenantContext => ({
      mode: 'allowed-set',
      allowedOrganizationIds: [orgA],
      actor: { kind: 'admin', id: `146-rep-a-${stamp}` },
    });
    /** A sales representative not assigned to A. */
    const repOfB = (): TenantContext => ({
      mode: 'allowed-set',
      allowedOrganizationIds: [orgB],
      actor: { kind: 'admin', id: `146-rep-b-${stamp}` },
    });

    const inContext = <T>(ctx: TenantContext, fn: (em: EntityManager) => Promise<T>): Promise<T> =>
      runWithTenantContext(ctx, () => fn(h.orm.em.fork() as EntityManager));

    it('QuoteRequestOrgPolicy: readable in its organization, unreadable from another (C1)', async () => {
      const read = (em: EntityManager) => em.findOne(QuoteRequestOrgPolicy, { organizationId: orgA });
      expect(await inContext(orgAdminA(), read)).not.toBeNull();
      expect(await inContext(repOfA(), read)).not.toBeNull();
      expect(await inContext(buyerB(), read)).toBeNull();
      expect(await inContext(repOfB(), read)).toBeNull();
    });

    /**
     * Plan I1, first half — **proven**: the chain resolves across a module
     * boundary at boot. `setupBackendServer` above ran the host's
     * `assertTransitiveParentsResolve` over the composed registry, which refuses
     * the boot for an unresolvable or ungrounded chain; this pins what it
     * resolved to.
     */
    it('QuoteRequestAccountPolicy: the transitive chain grounds at the @OrgScoped CustomerAccount (I1, boot)', () => {
      const rows = tenantClassifications();
      const child = rows.filter((meta) => meta.className === 'QuoteRequestAccountPolicy');
      expect(child).toEqual([
        expect.objectContaining({ scope: 'transitive', parentClassName: 'CustomerAccount', fk: 'customerAccountId' }),
      ]);
      const parent = rows.filter((meta) => meta.className === 'CustomerAccount');
      expect(parent).toEqual([expect.objectContaining({ scope: 'org', key: 'organizationId' })]);
    });

    /**
     * Plan I1, second half — **refuted**: `@TransitivelyScoped` registers the
     * chain and attaches no MikroORM filter (only `@OrgScoped` and
     * `@CustomerScoped` do; `derived-scope.ts` says transitively scoped reads
     * "must intersect the actor's org scope explicitly"). A bare read returns the
     * row in a foreign tenant context. This is pinned, not desired: it is the
     * reason every read of this table states its tenant itself — enforcement by
     * primary key under a named system scope (R11, T1), admin reads through the
     * account's own `@OrgScoped` read below. If a transitive filter ever lands,
     * this test goes red and the explicit intersection can be revisited.
     */
    it('QuoteRequestAccountPolicy: a bare read is not tenant-filtered (I1, query time)', async () => {
      const bare = (em: EntityManager) => em.findOne(QuoteRequestAccountPolicy, { customerAccountId: accountA });
      expect(await inContext(buyerB(), bare)).not.toBeNull();
      expect(await inContext(repOfB(), bare)).not.toBeNull();
    });

    /**
     * The read the admin surface takes (Phase 10b): the account through its own
     * `@OrgScoped` filter first, the policy row by primary key only for an
     * account that answered. Readable by an organization administrator of the
     * account's organization and by a sales representative assigned to it;
     * unreadable from another organization's buyer context and from a
     * representative not assigned to it.
     */
    it('QuoteRequestAccountPolicy: readable in its account\'s organization, unreadable from another, through the account (I1)', async () => {
      const scoped = async (em: EntityManager) => {
        const account = await em.findOne(CustomerAccount, { id: accountA });
        if (!account) return null;
        return em.findOne(QuoteRequestAccountPolicy, { customerAccountId: account.id });
      };
      expect(await inContext(orgAdminA(), scoped)).toMatchObject({ priceProposalsAllowed: false });
      expect(await inContext(repOfA(), scoped)).toMatchObject({ priceProposalsAllowed: false });
      expect(await inContext(buyerB(), scoped)).toBeNull();
      expect(await inContext(repOfB(), scoped)).toBeNull();
    });
  });
});
