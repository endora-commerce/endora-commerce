import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { EntitySchema, MikroORM, RawQueryFragment } from '@mikro-orm/postgresql';
import { orgScopeSql, orgScopeWhere, type TenantContext } from '@endora-commerce/platform/tenancy';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { Cart, QuoteRequestOrgPolicy } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
// The filter conds the `@OrgScoped` / `@CustomerScoped` decorators attach, from
// the same `dist` the harness composes, so the scratch entities below are
// filtered by exactly the code every real entity is.
import { customerFilterCond, orgFilterCond } from '../../../src/tenancy/filters.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { SalesRepAssignmentService } from '../../../../packages/modules/organizations/src/backend/services/sales-rep-assignment-service.js';
import { reachExcludedQuery } from '../../../../packages/modules/organizations/src/backend/services/admin-tenant-scope.js';

/**
 * Issue #955, architect ruling of 2026-11-09 — the conditions on the governor
 * table and on the subquery that carries a sales representative's reach into
 * the tenant filter:
 *
 *  - Q1.1 two real connections, an assignment on X racing a create / a move of
 *    D under X, committed in both orders: D is still governed by X;
 *  - Q1.2 all eight maintenance triggers exist and are enabled;
 *  - Q2 the R-1 matrix for the `not in (<owner's select>)` predicate, on a real
 *    `@OrgScoped` table, on `Cart` (`@CustomerScoped`, organization column
 *    present) and — for `populate` and `Collection.init`, which no real entity
 *    can exercise because none maps a collection — on scratch entities filtered
 *    by the platform's own conds;
 *  - Q2 the plan: a hashed SubPlan, and the function inlined (no Function Scan).
 */
const TRIGGERS = [
  ['organization_sales_rep_assignments', 'organization_reach_governor_assignments_insert'],
  ['organization_sales_rep_assignments', 'organization_reach_governor_assignments_update'],
  ['organization_sales_rep_assignments', 'organization_reach_governor_assignments_delete'],
  ['organization_sales_rep_assignments', 'organization_reach_governor_assignments_truncate'],
  ['organizations', 'organization_reach_governor_organizations_insert'],
  ['organizations', 'organization_reach_governor_organizations_update'],
  ['organizations', 'organization_reach_governor_organizations_delete'],
  ['organizations', 'organization_reach_governor_organizations_truncate'],
] as const;

describe('#955 — the reach governor table and the subquery that reads it', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-7);
  let seq = 0;
  const R = randomUUID(); // a roll-up representative governing nothing here
  const S = randomUUID();
  const rollup = new Set<string>([R, S]);
  let svc: SalesRepAssignmentService;

  const db = () => h.em().getConnection();
  async function organization(parent?: { id: string; path: string }): Promise<{ id: string; path: string }> {
    seq += 1;
    const id = randomUUID();
    const path = `${parent ? parent.path : '/'}${id}/`;
    await db().execute(
      `insert into organizations (id, name, name_search, tax_id, status, vat_status, registered_address, is_personal, parent_id, path, created_at, updated_at)
       values (?, ?, ?, ?, 'active', 'vat_payer', '{"street":"x","city":"x","postalCode":"x","country":"PL"}'::jsonb, false, ?, ?, now(), now())`,
      [id, `R955M ${seq}`, `r955m ${seq}`, `PL955M${stamp}${String(seq).padStart(3, '0')}`, parent?.id ?? null, path],
    );
    return { id, path };
  }
  const governorOf = async (id: string): Promise<string | null> =>
    (await db().execute<Array<{ g: string }>>('select governor_id::text as g from organization_reach_governor where organization_id = ?', [id]))[0]?.g ?? null;

  const repContext = async (rep: string): Promise<TenantContext> => {
    const reach = await svc.reachOf(rep);
    return resolveTenantContext(
      { kind: 'admin', adminUserId: rep },
      {
        allowAll: false,
        reach: 'excluding',
        excludedOrganizationIds: reach.excludedOrganizationIds,
        assignedOrganizationIds: reach.assignedOrganizationIds,
        excludedOrganizationsQuery: reachExcludedQuery(rep, rollup.has(rep)),
      },
    );
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new SalesRepAssignmentService(h.em, undefined, {
      treeService: new OrganizationTreeService(h.em),
      hasRollupCapability: async (adminUserId) => rollup.has(adminUserId),
    });
  }, 120_000);

  afterAll(async () => {
    await db().execute('delete from organization_sales_rep_assignments where admin_user_id in (?, ?)', [R, S]);
    await teardownBackendServer(h);
  });

  it('all eight maintenance triggers exist and are enabled (Q1.2)', async () => {
    const rows = await db().execute<Array<{ table: string; name: string; enabled: string }>>(
      `select c.relname as "table", t.tgname as "name", t.tgenabled as "enabled"
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where t.tgname like 'organization_reach_governor_%' and not t.tgisinternal
        order by 1, 2`,
    );
    expect(rows.map((r) => [r.table, r.name]).sort()).toEqual([...TRIGGERS].map((t) => [...t]).sort());
    expect(rows.every((r) => r.enabled === 'O'), JSON.stringify(rows)).toBe(true);
  });

  describe('two connections, both commit orders (Q1.1)', () => {
    const clients: pg.Client[] = [];
    const connect = async (): Promise<pg.Client> => {
      const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
      await client.connect();
      clients.push(client);
      return client;
    };
    afterAll(async () => {
      for (const client of clients) await client.end().catch(() => undefined);
    });

    const insertChild = (client: pg.Client, x: { id: string; path: string }, id: string) =>
      client.query(
        `insert into organizations (id, name, name_search, tax_id, status, vat_status, registered_address, is_personal, parent_id, path, created_at, updated_at)
         values ($1, 'R955C', 'r955c', $2, 'active', 'vat_payer', '{"street":"x","city":"x","postalCode":"x","country":"PL"}'::jsonb, false, $3, $4, now(), now())`,
        [id, `PL955C${id.slice(0, 8)}`, x.id, `${x.path}${id}/`],
      );
    const moveUnder = (client: pg.Client, d: { id: string; path: string }, x: { id: string; path: string }) =>
      client.query(`update organizations set path = $1::text || substring(path from $2::int), parent_id = case when id = $3::uuid then $4::uuid else parent_id end where path like $5::text`, [
        `${x.path}${d.id}/`,
        d.path.length + 1,
        d.id,
        x.id,
        `${d.path}%`,
      ]);
    const assign = (client: pg.Client, x: string) =>
      client.query(
        'insert into organization_sales_rep_assignments (id, organization_id, admin_user_id, created_at) values (gen_random_uuid(), $1, $2, now())',
        [x, S],
      );

    async function expectGovernedByX(x: string, d: string): Promise<void> {
      expect(await governorOf(d)).toBe(x);
      expect((await svc.reachOf(R)).excludedOrganizationIds).toContain(d);
      expect(await svc.canSeeOrganization(R, d)).toBe(false);
      expect(await svc.canSeeOrganization(S, d)).toBe(true);
    }

    for (const write of ['create', 'move'] as const) {
      for (const first of ['assignment', write] as const) {
        it(`${write} of D under X racing an assignment on X — ${first} takes the lock first`, async () => {
          const x = await organization();
          const existing = write === 'move' ? await organization() : null;
          const d = existing?.id ?? randomUUID();
          const t1 = await connect(); // the assignment
          const t2 = await connect(); // the create / move
          await t1.query('begin');
          await t2.query('begin');
          const other = write === 'create' ? () => insertChild(t2, x, d) : () => moveUnder(t2, existing!, x);
          if (first === 'assignment') {
            await assign(t1, x.id); // holds the advisory lock until it commits
            const waiting = other(); // blocks in its trigger
            await new Promise((resolve) => setTimeout(resolve, 200));
            await t1.query('commit');
            await waiting;
            await t2.query('commit');
          } else {
            await other();
            const waiting = assign(t1, x.id);
            await new Promise((resolve) => setTimeout(resolve, 200));
            await t2.query('commit');
            await waiting;
            await t1.query('commit');
          }
          await expectGovernedByX(x.id, d);
        }, 60_000);
      }
    }
  });

  describe('the R-1 matrix on real tables (Q2)', () => {
    let governed: { id: string; path: string };
    let free: { id: string; path: string };
    const ids = (): string[] => [governed.id, free.id];

    beforeAll(async () => {
      governed = await organization();
      free = await organization();
      await db().execute(
        'insert into organization_sales_rep_assignments (id, organization_id, admin_user_id, created_at) values (gen_random_uuid(), ?, ?, now())',
        [governed.id, S],
      );
      for (const id of ids()) {
        await db().execute(
          `insert into quote_request_org_policies (organization_id, price_proposals_allowed, created_at, updated_at) values (?, true, now(), now())`,
          [id],
        );
        await db().execute(
          `insert into carts (id, anonymous_cart_token, organization_id, created_at, updated_at) values (gen_random_uuid(), ?, ?, now(), now())`,
          [`r955-${id}`, id],
        );
      }
      // A cart that belongs to no organization: never in a representative's reach.
      await db().execute(
        `insert into carts (id, anonymous_cart_token, created_at, updated_at) values (gen_random_uuid(), ?, now(), now())`,
        [`r955-none-${stamp}`],
      );
    });

    const asRep = async <T>(rep: string, fn: () => Promise<T>): Promise<T> => runWithTenantContext(await repContext(rep), fn);
    const policyWhere = () => ({ organizationId: { $in: ids() } });
    const cartWhere = () => ({ $or: [{ organizationId: { $in: ids() } }, { anonymousCartToken: `r955-none-${stamp}` }] });

    it('@OrgScoped: find, count, findAndCount, findByCursor, fork, transactional', async () => {
      await asRep(R, async () => {
        const em = h.orm.em.fork();
        expect((await em.find(QuoteRequestOrgPolicy, policyWhere())).map((r) => r.organizationId)).toEqual([free.id]);
        expect(await h.orm.em.fork().count(QuoteRequestOrgPolicy, policyWhere())).toBe(1);
        const [rows, total] = await h.orm.em.fork().findAndCount(QuoteRequestOrgPolicy, policyWhere(), { limit: 10 });
        expect([rows.length, total]).toEqual([1, 1]);
        const cursor = await h.orm.em
          .fork()
          .findByCursor(QuoteRequestOrgPolicy, policyWhere(), { first: 10, orderBy: { organizationId: 'asc' } });
        expect([cursor.items.length, cursor.totalCount]).toEqual([1, 1]);
        const inTx = await h.orm.em.fork().transactional(async (tx) =>
          [(await tx.fork().find(QuoteRequestOrgPolicy, policyWhere())).length, (await tx.find(QuoteRequestOrgPolicy, policyWhere())).length],
        );
        expect(inTx).toEqual([1, 1]);
      });
      // S governs `governed`: both are in S's reach.
      await asRep(S, async () => {
        expect(await h.orm.em.fork().count(QuoteRequestOrgPolicy, policyWhere())).toBe(2);
      });
    });

    it('@OrgScoped: a where on the same column is merged, never replaced', async () => {
      await asRep(R, async () => {
        const em = () => h.orm.em.fork();
        expect(await em().count(QuoteRequestOrgPolicy, { organizationId: governed.id })).toBe(0);
        expect(await em().count(QuoteRequestOrgPolicy, { organizationId: free.id })).toBe(1);
        expect(await em().count(QuoteRequestOrgPolicy, { organizationId: { $nin: [free.id], $in: ids() } })).toBe(0);
        expect(await em().count(QuoteRequestOrgPolicy, { organizationId: { $ne: free.id, $in: ids() } })).toBe(0);
      });
    });

    it('@OrgScoped: nativeUpdate and nativeDelete touch only what the representative reaches', async () => {
      await asRep(R, async () => {
        expect(
          await h.orm.em.fork().nativeUpdate(QuoteRequestOrgPolicy, policyWhere(), { priceProposalsAllowed: false }),
        ).toBe(1);
        expect(await h.orm.em.fork().nativeDelete(QuoteRequestOrgPolicy, { organizationId: governed.id })).toBe(0);
      });
      const rows = await db().execute<Array<{ id: string; allowed: boolean }>>(
        'select organization_id::text as id, price_proposals_allowed as allowed from quote_request_org_policies where organization_id = any(?::uuid[]) order by 1',
        [`{${ids().join(',')}}`],
      );
      expect(rows.find((r) => r.id === governed.id)?.allowed).toBe(true);
      expect(rows.find((r) => r.id === free.id)?.allowed).toBe(false);
    });

    it('@CustomerScoped with the column (Cart): the same predicate, and a cart with no organization never matches', async () => {
      await asRep(R, async () => {
        const carts = await h.orm.em.fork().find(Cart, cartWhere());
        expect(carts.map((c) => c.organizationId)).toEqual([free.id]);
        expect(await h.orm.em.fork().count(Cart, cartWhere())).toBe(1);
      });
      // S governs `governed`, so neither organization here is excluded from S —
      // and an organization-less cart is still not S's.
      await asRep(S, async () => {
        const carts = await h.orm.em.fork().find(Cart, cartWhere());
        expect(carts.map((c) => c.organizationId).sort()).toEqual(ids().sort());
      });
      // A genuinely empty excluded set: `null not in (∅)` is true, so only the
      // spelled-out `is not null` keeps the organization-less cart out.
      const empty = resolveTenantContext(
        { kind: 'admin', adminUserId: R },
        {
          allowAll: false,
          reach: 'excluding',
          excludedOrganizationIds: [],
          assignedOrganizationIds: [],
          excludedOrganizationsQuery: { sql: 'select e.x from (select null::uuid as x where false) e', params: [] },
        },
      );
      await runWithTenantContext(empty, async () => {
        const carts = await h.orm.em.fork().find(Cart, cartWhere());
        expect(carts.map((c) => c.organizationId).sort()).toEqual(ids().sort());
        expect(await h.orm.em.fork().count(QuoteRequestOrgPolicy, policyWhere())).toBe(2);
      });
    });

    it('orgScopeWhere and orgScopeSql answer exactly what the filter answers', async () => {
      await asRep(R, async () => {
        const where = orgScopeWhere('organizationId');
        const viaWhere = await h.orm.em.fork().find(QuoteRequestOrgPolicy, { ...where, organizationId: { ...(where['organizationId'] as object), $in: ids() } }, { filters: false });
        expect(viaWhere.map((r) => r.organizationId)).toEqual([free.id]);
        const sql = orgScopeSql('p.organization_id');
        const viaSql = await h.em().getConnection().execute<Array<{ id: string }>>(
          `select p.organization_id::text as id from quote_request_org_policies p where p.organization_id = any(?::uuid[]) and ${sql.sql}`,
          [`{${ids().join(',')}}`, ...sql.params],
        );
        expect(viaSql.map((r) => r.id)).toEqual([free.id]);
      });
    });

    it('the plan is a hashed SubPlan over the inlined function, on customer_accounts and on orders', async () => {
      const query = reachExcludedQuery(R, true);
      for (const table of ['customer_accounts', 'orders']) {
        const rows = await db().execute<Array<{ 'QUERY PLAN': string }>>(
          `explain select count(*) from "${table}" t where t.organization_id is not null and t.organization_id not in (${query.sql})`,
          [...query.params],
        );
        const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        expect(plan, `${table}\n${plan}`).toMatch(/hashed SubPlan/);
        expect(plan, `${table}\n${plan}`).not.toMatch(/Function Scan on organizations_reach_excluded/);
      }
    });
  });

  describe('the R-1 matrix where only scratch entities can reach: populate and Collection.init (Q2)', () => {
    class Holder {
      id!: string;
      items: unknown;
    }
    class Item {
      id!: string;
      organizationId!: string | null;
      holder!: Holder;
    }
    let orm: MikroORM;
    let holderId = '';
    let governed = '';
    let free = '';

    beforeAll(async () => {
      governed = (await organization()).id;
      free = (await organization()).id;
      await db().execute(
        'insert into organization_sales_rep_assignments (id, organization_id, admin_user_id, created_at) values (gen_random_uuid(), ?, ?, now())',
        [governed, S],
      );
      const HolderSchema = new EntitySchema<Holder>({
        class: Holder,
        tableName: 'r955_holder',
        properties: { id: { type: 'uuid', primary: true }, items: { kind: '1:m', entity: () => Item, mappedBy: 'holder' } as never },
      });
      const ItemSchema = new EntitySchema<Item>({
        class: Item,
        tableName: 'r955_item',
        properties: {
          id: { type: 'uuid', primary: true },
          organizationId: { type: 'uuid', nullable: true },
          holder: { kind: 'm:1', entity: () => Holder },
        },
        filters: { org: { name: 'org', cond: () => orgFilterCond(), default: true, args: false } },
      });
      const CartLikeSchema = new EntitySchema<{ id: string; organizationId: string | null; customerAccountId: string | null }>({
        name: 'R955CartLike',
        tableName: 'r955_cart_like',
        properties: {
          id: { type: 'uuid', primary: true },
          organizationId: { type: 'uuid', nullable: true },
          customerAccountId: { type: 'uuid', nullable: true },
        },
        filters: { customerAccount: { name: 'customerAccount', cond: () => customerFilterCond('present'), default: true, args: false } },
      });
      orm = await MikroORM.init({
        entities: [HolderSchema, ItemSchema, CartLikeSchema],
        clientUrl: process.env['DATABASE_URL']!,
        allowGlobalContext: true,
        discovery: { warnWhenNoEntities: false },
      });
      await orm.em.getConnection().execute(`drop table if exists r955_item; drop table if exists r955_holder; drop table if exists r955_cart_like;
        create table r955_holder (id uuid primary key);
        create table r955_item (id uuid primary key, organization_id uuid null, holder_id uuid not null references r955_holder(id));
        create table r955_cart_like (id uuid primary key, organization_id uuid null, customer_account_id uuid null);`);
      holderId = randomUUID();
      await orm.em.getConnection().execute('insert into r955_holder (id) values (?)', [holderId]);
      for (const org of [governed, free, null]) {
        await orm.em.getConnection().execute('insert into r955_item (id, organization_id, holder_id) values (gen_random_uuid(), ?, ?)', [org, holderId]);
        await orm.em.getConnection().execute('insert into r955_cart_like (id, organization_id) values (gen_random_uuid(), ?)', [org]);
      }
    });

    afterAll(async () => {
      await orm.em.getConnection().execute('drop table if exists r955_item; drop table if exists r955_holder; drop table if exists r955_cart_like;');
      await orm.close();
    });

    const orgsOf = (items: Iterable<{ organizationId: string | null }>): Array<string | null> =>
      [...items].map((i) => i.organizationId).sort((a, b) => String(a).localeCompare(String(b)));

    it.each([
      ['a representative governed out of one of them', R, () => [free]],
      ['the representative governing the other one', S, () => [governed, free].sort()],
    ] as const)('%s: joined and select-in populate, Collection.init, and the @CustomerScoped arm', async (_label, rep, expected) => {
      await runWithTenantContext(await repContext(rep), async () => {
        const joined = await orm.em.fork().findOneOrFail(Holder, { id: holderId }, { populate: ['items' as never] });
        expect(orgsOf((joined.items as { getItems(): Item[] }).getItems())).toEqual(expected());
        const selectIn = await orm.em
          .fork()
          .findOneOrFail(Holder, { id: holderId }, { populate: ['items' as never], strategy: 'select-in' });
        expect(orgsOf((selectIn.items as { getItems(): Item[] }).getItems())).toEqual(expected());
        const lazy = await orm.em.fork().findOneOrFail(Holder, { id: holderId });
        const collection = lazy.items as { init(): Promise<unknown>; getItems(): Item[] };
        await collection.init();
        expect(orgsOf(collection.getItems())).toEqual(expected());
        expect(orgsOf(await orm.em.fork().find('R955CartLike', {}) as Array<{ organizationId: string | null }>)).toEqual(expected());
      });
    });

    it("leaves MikroORM's raw-fragment cache empty over a thousand statements", async () => {
      const before = RawQueryFragment.checkCacheSize();
      await runWithTenantContext(await repContext(R), async () => {
        for (let i = 0; i < 250; i += 1) {
          const em = orm.em.fork();
          await em.find(Item, {});
          await em.count(Item, {});
          await em.findOneOrFail(Holder, { id: holderId }, { populate: ['items' as never] });
          await em.find('R955CartLike', {});
        }
      });
      expect(RawQueryFragment.checkCacheSize()).toBe(before);
    }, 120_000);
  });
});
