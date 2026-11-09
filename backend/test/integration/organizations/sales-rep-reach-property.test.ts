import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import type { Command } from '@endora-commerce/platform/commands';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  AdminUser,
  Organization,
  OrganizationSalesRepAssignment,
  QuoteRequestOrgPolicy,
} from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { SalesRepAssignmentService } from '../../../../packages/modules/organizations/src/backend/services/sales-rep-assignment-service.js';
import { reachExcludedQuery } from '../../../../packages/modules/organizations/src/backend/services/admin-tenant-scope.js';

/**
 * Issue #305 — the reach rule exists once.
 *
 * The tenant scope describes a sales representative's reach by its complement,
 * the organizations governed by somebody else (`reachOf(rep).excludedOrganizationIds`),
 * computed in one statement. The one-id question stays `canSeeOrganization`.
 * The guarantee that they are **one** rule is this property: for every node of
 * the fixture tree, every representative, flat and roll-up,
 *
 *     canSeeOrganization(rep, id) === !excluded(rep).includes(id)
 *
 * The fixture holds every governance shape the rule distinguishes:
 *
 *     a   (R)              ab (R, S)          s  (S)            u (nobody)
 *     ├── ac (nobody)                         ├── sc (nobody)
 *     └── rs (S)                              └── sr (R)
 *         └── rsc (nobody)                        └── src (nobody)
 *
 *     x   (S, stored path unreadable)
 *     └── xc (nobody, its own path names x)
 *
 * `x` is a data defect the create hook and the repair migration prevent, and
 * the rule must still answer it exactly: its own path names no ancestor, so it
 * governs itself, and `xc`'s path names it, so under roll-up it governs `xc`.
 *
 * Issue #955 — the roll-up half of the excluded set is read off the
 * materialised `organization_reach_governor` table, and a stale row there
 * **widens** reach. So the property is held again after every kind of write
 * that can move a governor — create, assign, a second assignment on the same
 * organization, unassign, set-parent, move, delete, and the raw writes the
 * fixtures and the demo reset make — each through its real write path, and
 * the table is compared with a rebuild from scratch after each one.
 */
let seq = 0;
async function node(em: EntityManager, label: string, parent?: Organization): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name: `R305P ${label}`,
    taxId: `PL305P${String(seq).padStart(4, '0')}${Date.now().toString().slice(-6)}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    ...(parent ? { parentId: parent.id } : {}),
  });
  await em.persistAndFlush(org);
  org.path = `${parent ? parent.path : '/'}${org.id}/`;
  await em.flush();
  return org;
}

describe('#305 — canSeeOrganization and the excluded set are one rule', () => {
  let h: BackendServerHandle;
  let svc: SalesRepAssignmentService;
  const rollup = new Set<string>();
  const R = randomUUID();
  const S = randomUUID();
  const T = randomUUID(); // assigned to nothing
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new SalesRepAssignmentService(h.em, undefined, {
      treeService: new OrganizationTreeService(h.em),
      hasRollupCapability: async (adminUserId) => rollup.has(adminUserId),
    });
    const em = h.em();
    const a = await node(em, 'a');
    const ac = await node(em, 'ac', a);
    const rs = await node(em, 'rs', a);
    const rsc = await node(em, 'rsc', rs);
    const ab = await node(em, 'ab');
    const s = await node(em, 's');
    const sc = await node(em, 'sc', s);
    const sr = await node(em, 'sr', s);
    const src = await node(em, 'src', sr);
    const u = await node(em, 'u');
    const x = await node(em, 'x');
    const xc = await node(em, 'xc', x);
    await em.getConnection().execute(`update organizations set path = '' where id = ?`, [x.id]);
    Object.assign(ids, {
      a: a.id, ac: ac.id, rs: rs.id, rsc: rsc.id, ab: ab.id, s: s.id, sc: sc.id, sr: sr.id, src: src.id, u: u.id,
      x: x.id, xc: xc.id,
    });
    const assign = (organizationId: string, adminUserId: string) =>
      em.create(OrganizationSalesRepAssignment, { organizationId, adminUserId });
    assign(a.id, R);
    assign(ab.id, R);
    assign(ab.id, S);
    assign(rs.id, S);
    assign(s.id, S);
    assign(sr.id, R);
    assign(x.id, S);
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    await h
      .em()
      .getConnection()
      .execute('delete from organization_sales_rep_assignments where admin_user_id in (?, ?)', [R, S]);
    await teardownBackendServer(h);
  });

  const setRollup = (on: boolean): void => {
    for (const rep of [R, S, T]) (on ? rollup.add(rep) : rollup.delete(rep));
  };

  /** Who sees which node, by the rule (§0 of the #305 design). */
  const EXPECTED: Record<'flat' | 'rollup', Record<string, Record<string, boolean>>> = {
    flat: {
      R: { a: true, ac: true, rs: false, rsc: true, ab: true, s: false, sc: true, sr: true, src: true, u: true, x: false, xc: true },
      S: { a: false, ac: true, rs: true, rsc: true, ab: true, s: true, sc: true, sr: false, src: true, u: true, x: true, xc: true },
      T: { a: false, ac: true, rs: false, rsc: true, ab: false, s: false, sc: true, sr: false, src: true, u: true, x: false, xc: true },
    },
    rollup: {
      R: { a: true, ac: true, rs: false, rsc: false, ab: true, s: false, sc: false, sr: true, src: true, u: true, x: false, xc: false },
      S: { a: false, ac: false, rs: true, rsc: true, ab: true, s: true, sc: true, sr: false, src: false, u: true, x: true, xc: true },
      T: { a: false, ac: false, rs: false, rsc: false, ab: false, s: false, sc: false, sr: false, src: false, u: true, x: false, xc: false },
    },
  };
  const REPS = { R, S, T } as const;

  describe.each(['flat', 'rollup'] as const)('%s', (mode) => {
    beforeAll(() => setRollup(mode === 'rollup'));

    it.each(['R', 'S', 'T'] as const)('canSeeOrganization for %s follows the rule', async (rep) => {
      const seen: Record<string, boolean> = {};
      for (const key of Object.keys(ids)) seen[key] = await svc.canSeeOrganization(REPS[rep], ids[key]!);
      expect(seen).toEqual(EXPECTED[mode][rep]);
    });

    it.each(['R', 'S', 'T'] as const)('the excluded set for %s is exactly the complement', async (rep) => {
      const { excludedOrganizationIds } = await svc.reachOf(REPS[rep]);
      const excluded = new Set(excludedOrganizationIds);
      for (const key of Object.keys(ids)) {
        const id = ids[key]!;
        expect(!excluded.has(id), `${rep} ${mode} ${key}`).toBe(await svc.canSeeOrganization(REPS[rep], id));
      }
    });

    it.each(['R', 'S', 'T'] as const)('the assigned set for %s is the reach it governs', async (rep) => {
      const { assignedOrganizationIds } = await svc.reachOf(REPS[rep]);
      const mine = new Set(assignedOrganizationIds);
      const governed = Object.keys(ids).filter((key) => mine.has(ids[key]!)).sort();
      const expected =
        mode === 'flat'
          ? { R: ['a', 'ab', 'sr'], S: ['ab', 'rs', 's', 'x'], T: [] }[rep]
          : { R: ['a', 'ab', 'ac', 'sr', 'src'], S: ['ab', 'rs', 'rsc', 's', 'sc', 'x', 'xc'], T: [] }[rep];
      expect(governed).toEqual([...expected].sort());
      expect(await svc.listAssignedOrganizationIds(REPS[rep])).toEqual(expect.arrayContaining(assignedOrganizationIds));
    });
  });

  it('a roll-up reach that meets the unreadable governing path names it in one warn (ruling Q1 on PR #954)', async () => {
    const warn = vi.fn();
    const warned = new SalesRepAssignmentService(h.em, undefined, {
      treeService: new OrganizationTreeService(h.em),
      hasRollupCapability: async () => true,
      warn,
    });
    await warned.reachOf(T);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]![0] as { organizationIds: string[] }).organizationIds).toContain(ids['x']);
  });

  it('the excluded set never names a personal organization (they cannot be assigned)', async () => {
    setRollup(true);
    const { excludedOrganizationIds } = await svc.reachOf(T);
    if (excludedOrganizationIds.length === 0) return;
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ n: string }>>(
        'select count(*)::text as n from organizations where is_personal and id = any(?::uuid[])',
        [`{${excludedOrganizationIds.join(',')}}`],
      );
    expect(rows[0]!.n).toBe('0');
  });

  /**
   * Issue #955 — after every mutation type, the maintained governor table is
   * still the rule. Each step goes through the write path an operator uses
   * (the admin routes, so the Commands and the assignment service), except the
   * last, which writes the way fixtures and the demo reset do.
   *
   *     p (–)                q (–)
   *     ├── p1 (–)           └── q1 (–)
   *     │   └── p11 (–)
   *     └── p2 (–)
   */
  describe('after every mutation type (#955)', () => {
    const stamp = Date.now().toString().slice(-7);
    let R2 = '';
    let S2 = '';
    const T2 = randomUUID();
    const tree: Record<string, string> = {};
    let channelId = '';
    let created = 0;

    const admin = (method: 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
      h.app.inject({ method, url, cookies: { b2b_session: 'stub-admin-session' }, ...(payload ? { payload } : {}) });
    const ok = async (pending: ReturnType<typeof admin>, status: number): Promise<Record<string, unknown>> => {
      const res = await pending;
      expect(res.statusCode, res.body).toBe(status);
      return status === 204 ? {} : (res.json() as { data: Record<string, unknown> }).data;
    };
    const create = async (label: string): Promise<string> => {
      created += 1;
      const data = await ok(
        admin('POST', '/api/v1/admin/organizations', {
          name: `R955 ${label} ${stamp}`,
          taxId: `PL955${stamp}${String(created).padStart(3, '0')}`,
          registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
          salesChannelIds: [channelId],
        }),
        201,
      );
      tree[label] = data['id'] as string;
      return tree[label]!;
    };
    const setParent = (label: string, parent: string | null) =>
      ok(admin('POST', `/api/v1/admin/organizations/${tree[label]}/parent`, { parentId: parent === null ? null : tree[parent] }), 200);
    const assignRep = (label: string, rep: string) =>
      ok(admin('POST', `/api/v1/admin/organizations/${tree[label]}/sales-reps`, { adminUserId: rep }), 201);
    const unassignRep = (label: string, rep: string) =>
      ok(admin('DELETE', `/api/v1/admin/organizations/${tree[label]}/sales-reps/${rep}`), 204);

    /** The maintained table against a rebuild from scratch, in a transaction that is rolled back. */
    async function staleGovernorRows(): Promise<number> {
      const sentinel = new Error('rollback');
      let stale = -1;
      await h.orm.em
        .fork()
        .transactional(async (tx) => {
          await tx.execute('create temporary table "r955_maintained" on commit drop as select * from "organization_reach_governor"');
          await tx.execute('select "organizations_reach_governor_rebuild"(null)');
          const rows = await tx.execute<Array<{ n: string }>>(
            `select count(*)::text as "n" from (
               (select * from "r955_maintained" except select * from "organization_reach_governor")
               union all
               (select * from "organization_reach_governor" except select * from "r955_maintained")
             ) d`,
          );
          stale = Number(rows[0]!.n);
          throw sentinel;
        })
        .catch((error: unknown) => {
          if (error !== sentinel) throw error;
        });
      return stale;
    }

    /** The set the tenant filter's subquery selects (`organizations_reach_excluded`), read directly. */
    async function excludedBySubquery(rep: string, rollupOn: boolean): Promise<Set<string>> {
      const query = reachExcludedQuery(rep, rollupOn);
      const rows = await h.em().getConnection().execute<Array<{ x: string }>>(
        `select q.x::text as x from (${query.sql}) q`,
        [...query.params],
      );
      return new Set(rows.map((r) => r.x));
    }

    /** The fixture organizations the global `org` filter hides from `rep`, on a real `@OrgScoped` table. */
    async function hiddenByFilter(rep: string): Promise<Set<string>> {
      const ids = Object.values(tree);
      const reach = await svc.reachOf(rep);
      const ctx = resolveTenantContext(
        { kind: 'admin', adminUserId: rep },
        {
          allowAll: false,
          reach: 'excluding',
          excludedOrganizationIds: reach.excludedOrganizationIds,
          assignedOrganizationIds: reach.assignedOrganizationIds,
          excludedOrganizationsQuery: reachExcludedQuery(rep, rollup.has(rep)),
        },
      );
      const visible = await runWithTenantContext(ctx, async () =>
        h.orm.em.fork().find(QuoteRequestOrgPolicy, { organizationId: { $in: ids } }),
      );
      const seen = new Set(visible.map((row: { organizationId: string }) => row.organizationId));
      return new Set(ids.filter((id) => !seen.has(id)));
    }

    async function expectOneRule(step: string): Promise<void> {
      expect(await staleGovernorRows(), `${step}: governor rows differing from a rebuild`).toBe(0);
      // Every fixture organization carries one row of a real tenant table, so
      // the filter's answer is observable (#955, architect ruling Q2).
      await h.em().getConnection().execute(
        `insert into quote_request_org_policies (organization_id, price_proposals_allowed, created_at, updated_at)
         select o.id, true, now(), now() from organizations o where o.id = any(?::uuid[])
         on conflict do nothing`,
        [`{${Object.values(tree).join(',')}}`],
      );
      for (const mode of ['flat', 'rollup'] as const) {
        for (const rep of [R2, S2, T2]) (mode === 'rollup' ? rollup.add(rep) : rollup.delete(rep));
        for (const [name, rep] of [['R2', R2], ['S2', S2], ['T2', T2]] as const) {
          const listed = new Set((await svc.reachOf(rep)).excludedOrganizationIds);
          const selected = await excludedBySubquery(rep, mode === 'rollup');
          expect([...selected].sort(), `${step}: ${name} ${mode} subquery = reachOf`).toEqual([...listed].sort());
          const hidden = await hiddenByFilter(rep);
          for (const [label, id] of Object.entries(tree)) {
            const sees = await svc.canSeeOrganization(rep, id);
            expect(!listed.has(id), `${step}: ${name} ${mode} ${label}`).toBe(sees);
            expect(!hidden.has(id), `${step}: ${name} ${mode} ${label} (filter)`).toBe(sees);
          }
        }
      }
    }

    /** An assignment written inside a Command Bus transaction, through the service's own write. */
    const assignmentCommand = (
      label: string,
      rep: string,
      write: 'assign' | 'unassign',
      thenFail = false,
    ): Command<void> => ({
      action: write === 'assign' ? 'organization.sales_rep_assign' : 'organization.sales_rep_unassign',
      objectType: 'organization',
      objectId: tree[label]!,
      run: async ({ em }) => {
        const service = new SalesRepAssignmentService(() => em);
        if (write === 'assign') await service.assign({ organizationId: tree[label]!, adminUserId: rep });
        else await service.unassign({ organizationId: tree[label]!, adminUserId: rep });
        if (thenFail) throw new Error('#955: roll the command back');
        return { result: undefined, before: null, after: { adminUserId: rep } };
      },
    });
    const commandBus = () =>
      (h.container.cradle as unknown as { commandBus: { run<T>(command: Command<T>): Promise<T> } }).commandBus;

    beforeAll(async () => {
      const em = h.orm.em.fork();
      const rep = (label: string): AdminUser =>
        em.create(AdminUser, {
          email: `r955-${label}-${stamp}@scope.local`,
          passwordHash: 'x'.repeat(60),
          firstName: '955',
          lastName: label,
        });
      const r = rep('r');
      const s = rep('s');
      await em.persistAndFlush([r, s]);
      R2 = r.id;
      S2 = s.id;
      const channels = await em
        .getConnection()
        .execute<Array<{ id: string }>>('select "id" from "sales_channels" order by "system_default" desc limit 1');
      channelId = channels[0]!.id;
      for (const label of ['p', 'p1', 'p11', 'p2', 'q', 'q1']) await create(label);
      await setParent('p1', 'p');
      await setParent('p11', 'p1');
      await setParent('p2', 'p');
      await setParent('q1', 'q');
    }, 60_000);

    afterAll(async () => {
      const db = h.em().getConnection();
      await db.execute('delete from organization_sales_rep_assignments where admin_user_id in (?, ?)', [R2, S2]);
      await db.execute('delete from quote_request_org_policies where organization_id = any(?::uuid[])', [
        `{${Object.values(tree).join(',')}}`,
      ]);
    });

    it('holds after a create, every assignment change, set-parent, move, delete and a raw write', async () => {
      await expectOneRule('the fixture');
      await create('n');
      await expectOneRule('create');
      await assignRep('p', R2);
      await expectOneRule('assign over an ungoverned subtree');
      await assignRep('p1', S2);
      await expectOneRule('assign under a governed node (the override)');
      await setParent('n', 'p11');
      await expectOneRule('set-parent of a root under an overridden node');
      await setParent('p1', 'q');
      await expectOneRule('move of a subtree to another tree');
      await assignRep('q', R2);
      await expectOneRule('assign above an overridden subtree');
      await unassignRep('p1', S2);
      await expectOneRule('unassign: the subtree falls to the nearer ancestor');
      await assignRep('q', S2);
      await expectOneRule('a second representative on the same organization');
      await unassignRep('q', R2);
      await expectOneRule('unassign one of two representatives');
      await unassignRep('q', S2);
      await expectOneRule('unassign the last representative');
      await setParent('p1', 'p');
      await expectOneRule('move back under a governed node');
      await ok(admin('DELETE', `/api/v1/admin/organizations/${tree['n']}`), 204);
      await expectOneRule('delete');

      // Through the Command Bus, then its undo — the inverse write — and a
      // Command that fails after its write, whose projection must roll back with it.
      await commandBus().run(assignmentCommand('p2', S2, 'assign'));
      await expectOneRule('assign through the Command Bus');
      await commandBus().run(assignmentCommand('p2', S2, 'unassign'));
      await expectOneRule('undo of that assignment');
      await expect(commandBus().run(assignmentCommand('q', S2, 'assign', true))).rejects.toThrow(/roll the command back/);
      await expectOneRule('a Command that fails after its write');

      // The writes fixtures and the demo reset make, which no Command sees.
      const db = h.em().getConnection();
      await db.execute(
        'insert into organization_sales_rep_assignments (id, organization_id, admin_user_id, created_at) values (gen_random_uuid(), ?, ?, now())',
        [tree['q1'], S2],
      );
      await expectOneRule('raw insert of an assignment');
      await db.execute(`update organizations set path = '' where id = ?`, [tree['p1']]);
      await expectOneRule('raw write of an unreadable path');
      await db.execute('delete from organization_sales_rep_assignments where organization_id = ? and admin_user_id = ?', [
        tree['p'],
        R2,
      ]);
      await expectOneRule('raw delete of an assignment');
    }, 240_000);
  });
});
