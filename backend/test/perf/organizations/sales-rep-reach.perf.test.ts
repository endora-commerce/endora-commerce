// perf-weight: fast — about 20 s locally (2026-11-08: seeding 50 000 organizations and 3 000 assignments, then 4 × 200 reach computations and 4 × 40 list reads); not yet timed on the CI runner.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { SalesRepAssignmentService } from '../../../../packages/modules/organizations/src/backend/services/sales-rep-assignment-service.js';

/**
 * Issue #305, design §3 — the cost of one reach rule on every surface.
 *
 * A sales representative's tenant scope is the complement of the organizations
 * governed by somebody else, computed per request in one statement
 * (`SalesRepAssignmentService.reachOf`); there is no cache (owner ruling
 * E-305-2, 2026-11-08). This holds the budget that ruling depends on:
 *
 *  - `reachOf` — which gives both the excluded and the assigned set — adds at
 *    most `PERF_REACH_P95_MS` (default 5 ms) at the 95th percentile, flat and
 *    roll-up;
 *  - `GET /admin/customers?pageSize=50` and `GET /admin/orders?pageSize=50`
 *    for a roll-up representative answer within `PERF_REACH_RATIO` (default
 *    1.5) × the platform administrator's p95 for the same request.
 *
 * Seed (design §3): 50 000 organizations — 45 000 personal, 5 000 company
 * organizations in trees of 10 (a binary tree, depth ≤ 4) — and 3 000
 * assignment rows over 40 representatives, roll-up on for half of them.
 *
 * Issue #955: the roll-up reach is one scan of the materialised
 * `organization_reach_governor` table (design D5.1), and the excluded list
 * travels into every tenant-scoped statement as one array parameter. The seed
 * below writes through raw SQL, which the table's triggers maintain exactly as
 * they do for the Commands. There is still no cache (E-305-2); if this fails,
 * report the measurement rather than move a threshold.
 *
 * Tuning knobs (env):
 *   PERF_RUN            — set to 'true' to run; otherwise skipped.
 *   PERF_ITERATIONS     — samples per measurement (default 200 for the reach, a fifth of it per list)
 *   PERF_REACH_P95_MS   — the reach's p95 budget (default 5)
 *   PERF_REACH_RATIO    — the rep's list p95 over the admin's (default 1.5)
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '200');
const reachBudget = Number(process.env['PERF_REACH_P95_MS'] ?? '5');
const ratioBudget = Number(process.env['PERF_REACH_RATIO'] ?? '1.5');

const PERSONAL = 45_000;
const COMPANIES = 5_000;
const TREE = 10;
const ASSIGNMENTS = 3_000;
const REPS = 40;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

async function sample(times: number, run: () => Promise<unknown>): Promise<number> {
  for (let i = 0; i < 5; i += 1) await run(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  return p95(samples);
}

describe.skipIf(!shouldRun)('#305 — the sales-representative reach at 50 000 organizations', () => {
  let h: BackendServerHandle;
  let svc: SalesRepAssignmentService;
  const stamp = Date.now().toString().slice(-7);
  const reps = Array.from({ length: REPS }, () => randomUUID());
  const rollup = new Set<string>(reps.slice(0, REPS / 2));
  const REP_SESSION = `stub-305-perf-rep-${stamp}`;
  let roleId = '';
  let rolePermissionsBefore: string[] | null = null;
  const results: Record<string, number> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    const db = h.em().getConnection();
    await db.execute(
      `insert into organizations (id, name, name_search, tax_id, status, vat_status, registered_address, is_personal, path, created_at, updated_at)
       select md5('r305-p-${stamp}-' || g)::uuid, 'R305 Person ' || g, 'r305 person ' || g, null, 'active',
              'vat_exempt', '{"street":"x","city":"Kraków","postalCode":"30-001","country":"PL"}'::jsonb, true,
              '/' || md5('r305-p-${stamp}-' || g)::uuid || '/', now(), now()
         from generate_series(1, ${PERSONAL}) g`,
    );
    // Company trees: node k of a tree of TREE hangs under node (k - 1) / 2.
    const ids: string[] = [];
    const paths: string[] = [];
    const parents: Array<string | null> = [];
    for (let i = 0; i < COMPANIES; i += 1) {
      const id = randomUUID();
      const k = i % TREE;
      const parentIndex = k === 0 ? null : i - k + Math.floor((k - 1) / 2);
      ids.push(id);
      parents.push(parentIndex === null ? null : ids[parentIndex]!);
      paths.push(parentIndex === null ? `/${id}/` : `${paths[parentIndex]!}${id}/`);
    }
    await db.execute(
      `insert into organizations (id, name, name_search, tax_id, status, vat_status, registered_address, is_personal, parent_id, path, created_at, updated_at)
       select c.id, 'R305 Company ' || c.n, 'r305 company ' || c.n, 'R305C${stamp}' || c.n, 'active', 'vat_payer',
              '{"street":"x","city":"Kraków","postalCode":"30-001","country":"PL"}'::jsonb, false, c.parent_id, c.path, now(), now()
         from unnest(?::uuid[], ?::uuid[], ?::text[]) with ordinality as c(id, parent_id, path, n)`,
      [`{${ids.join(',')}}`, `{${parents.map((p) => p ?? 'NULL').join(',')}}`, `{${paths.map((p) => `"${p}"`).join(',')}}`],
    );
    // 3 000 distinct organizations (7 is coprime to 5 000), round-robin over the reps.
    const rows = Array.from({ length: ASSIGNMENTS }, (_, r) => [ids[(r * 7) % COMPANIES]!, reps[r % REPS]!] as const);
    await db.execute(
      `insert into organization_sales_rep_assignments (id, organization_id, admin_user_id, created_at)
       select gen_random_uuid(), a.o, a.r, now() from unnest(?::uuid[], ?::uuid[]) as a(o, r)`,
      [`{${rows.map(([o]) => o).join(',')}}`, `{${rows.map(([, r]) => r).join(',')}}`],
    );
    await db.execute('analyze organizations');
    await db.execute('analyze organization_sales_rep_assignments');

    svc = new SalesRepAssignmentService(h.em, undefined, {
      treeService: new OrganizationTreeService(h.em),
      hasRollupCapability: async (adminUserId) => rollup.has(adminUserId),
    });

    // A real roll-up representative for the HTTP reads, assigned like the first rep.
    await withSystemScope('#305 perf: a roll-up representative', async () => {
      const em = h.orm.em.fork();
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['customers:read', 'orders:read', 'organizations:rollup'];
      if (!role) {
        role = em.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        rolePermissionsBefore = [...role.permissions];
        role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      }
      await em.persistAndFlush(role);
      roleId = role.id;
      const rep = em.create(AdminUser, {
        email: `r305-perf-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '305',
        lastName: 'Perf',
      });
      await em.persistAndFlush(rep);
      await db.execute(
        `insert into organization_sales_rep_assignments (id, organization_id, admin_user_id, created_at)
         select gen_random_uuid(), organization_id, ?, now() from organization_sales_rep_assignments where admin_user_id = ?`,
        [rep.id, reps[0]],
      );
      ADMIN_COOKIES[REP_SESSION] = { adminUserId: rep.id };
    });
  }, 300_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[REP_SESSION];
    if (rolePermissionsBefore !== null) {
      const before = rolePermissionsBefore;
      await withSystemScope('#305 perf: restore the sales representative role', async () => {
        const em = h.orm.em.fork();
        const role = await em.findOneOrFail(AdminRole, { id: roleId });
        role.permissions = before;
        await em.flush();
      });
    }
    // eslint-disable-next-line no-console
    console.log('[perf #305] p95 (ms):', JSON.stringify(results));
    await teardownBackendServer(h);
  });

  it.each([
    ['flat', () => reps[REPS - 1]!],
    ['roll-up', () => reps[0]!],
  ] as const)('the reach of a %s representative is within budget', async (label, rep) => {
    const reach = await svc.reachOf(rep());
    expect(reach.excludedOrganizationIds.length).toBeGreaterThan(0);
    const reachP95 = await sample(iterations, () => svc.reachOf(rep()));
    results[`reachOf ${label}`] = Number(reachP95.toFixed(2));
    expect(reachP95, `reachOf ${label} p95`).toBeLessThanOrEqual(reachBudget);
  }, 600_000);

  // Architect ruling Q3 on #955: every tenant-scoped statement of a
  // representative's list carries the reach exactly once — the orders list
  // used to spell the ambient reach a second time beside the global filter.
  it.each([
    ['/api/v1/admin/orders?pageSize=50', 'orders'],
    ['/api/v1/admin/customers?pageSize=50', 'customer_accounts'],
  ])('%s carries the excluded predicate once per statement', async (url, table) => {
    const connection = h.em().getConnection() as unknown as object;
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(connection)) as {
      execute: (...args: unknown[]) => Promise<unknown>;
    };
    const original = proto.execute;
    const statements: string[] = [];
    proto.execute = async function (this: unknown, ...args: unknown[]) {
      const query = args[0] as string | { toSQL(): { sql: string } };
      statements.push(typeof query === 'string' ? query : query.toSQL().sql);
      return original.apply(this, args);
    };
    try {
      const res = await h.app.inject({ method: 'GET', url, cookies: { b2b_session: REP_SESSION } });
      expect(res.statusCode, res.body).toBe(200);
    } finally {
      proto.execute = original;
    }
    const onTable = statements.filter((sql) => new RegExp(`from "${table}"`).test(sql));
    expect(onTable.length).toBeGreaterThan(0);
    for (const sql of onTable) {
      expect(sql.match(/organizations_reach_excluded/g)?.length ?? 0, sql.slice(0, 300)).toBe(1);
    }
  }, 120_000);

  // Issue #955 Phase 2 (owner ruling of 2026-11-10): the scope hook no longer
  // computes the reach on every admin request — the lists load lazily, once
  // per request, and only for the single-id questions and the ranking. The
  // threshold is the design's and is never moved.
  it.each(['/api/v1/admin/customers?pageSize=50', '/api/v1/admin/orders?pageSize=50'])(
    '%s for a roll-up representative is within the ratio of the platform administrator’s',
    async (url) => {
      const read = (cookie: string) => async () => {
        const res = await h.app.inject({ method: 'GET', url, cookies: { b2b_session: cookie } });
        if (res.statusCode !== 200) throw new Error(`${url} answered ${res.statusCode}: ${res.body}`);
      };
      const times = Math.max(20, Math.round(iterations / 5));
      const admin = await sample(times, read('stub-admin-session'));
      const rep = await sample(times, read(REP_SESSION));
      results[`${url} admin`] = Number(admin.toFixed(2));
      results[`${url} rep`] = Number(rep.toFixed(2));
      expect(rep, `${url}: rep ${rep.toFixed(1)} ms vs admin ${admin.toFixed(1)} ms`).toBeLessThanOrEqual(
        admin * ratioBudget,
      );
    },
    600_000,
  );
});
