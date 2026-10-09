import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { createDemoComposition } from '@endora-commerce/demo-composition';
import { manifest as adminRolesManifest } from '@endora-commerce/mod-admin-roles';
import { manifest as adminUsersManifest } from '@endora-commerce/mod-admin-users';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * A demo seed or reset that stops part-way never leaves a demo administrator
 * without a role.
 *
 * An administrator without a role is refused everywhere, and a demo run is not
 * one transaction: it is every module's body and then a list of composition
 * steps, any of which can fail. So the property is held at the two points where
 * a run can stop with the accounts in existence — after the modules' own seeds,
 * before any composition step has run; and after the composition's withdrawal,
 * before the modules have removed their rows.
 *
 * The bodies are the real ones, reached the way the runner reaches them —
 * through each manifest's `demo` declaration — over this file's own database.
 */
const DEMO_ADMINS: Record<string, string> = {
  'admin@demo.local': 'platform_admin',
  'sales-rep@demo.local': 'sales_representative',
  'sales-rep-other@demo.local': 'sales_representative',
};

/** A manifest's demo declaration, which both of these modules make. */
function demoOf(manifest: { id: string; demo?: unknown }) {
  const demo = manifest.demo as
    | false
    | undefined
    | {
        seed(context: ModuleDemoContext<never>): Promise<unknown>;
        reset(context: ModuleDemoContext<never>): Promise<unknown>;
      };
  if (!demo) throw new Error(`${manifest.id} declares no demo data`);
  return demo;
}

const rolesDemo = demoOf(adminRolesManifest);
const usersDemo = demoOf(adminUsersManifest);

describe('demo administrators hold their roles at every point a run can stop', () => {
  let h: BackendServerHandle;
  let context: ModuleDemoContext<never>;

  async function demoAdmins(): Promise<Record<string, string | null>> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select u."email", r."code" from "admin_users" u
           left join "admin_roles" r on r."id" = u."admin_role_id"
          where u."email" in (?, ?, ?)`,
        Object.keys(DEMO_ADMINS),
      )) as Array<{ email: string; code: string | null }>;
    return Object.fromEntries(rows.map((row) => [row.email, row.code]));
  }

  /** The composition as an instance holding only the two admin modules runs it. */
  const adminOnlyComposition = () =>
    createDemoComposition({
      em: h.em(),
      isPresent: (moduleId) => moduleId === 'admin_users' || moduleId === 'admin_roles',
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    context = { ctx: { cradle: () => h.container.cradle } } as unknown as ModuleDemoContext<never>;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('seed: every account holds its role before a single composition step has run', async () => {
    // Dependency order, as the runner seeds: roles, then the accounts.
    await rolesDemo.seed(context);
    await usersDemo.seed(context);

    // The run stops here — the composition, where the megamenu, the stock and
    // the images are wired, never starts.
    expect(await demoAdmins()).toEqual(DEMO_ADMINS);
  });

  it('seed: a second run and the composition step change nothing', async () => {
    await usersDemo.seed(context);
    await adminOnlyComposition().apply();
    expect(await demoAdmins()).toEqual(DEMO_ADMINS);
  });

  it('seed: an account an interrupted earlier run left without a role is given it', async () => {
    await h
      .em()
      .getConnection()
      .execute(`update "admin_users" set "admin_role_id" = null where "email" = ?`, [
        'sales-rep@demo.local',
      ]);
    await adminOnlyComposition().apply();
    expect(await demoAdmins()).toEqual(DEMO_ADMINS);
  });

  it('seed: a role an earlier seed left holding an undeclared code can be saved again (issue #180)', async () => {
    // What an instance seeded before the fix holds: the retired code, plus a
    // grant an operator added since.
    const stale = ['rfqs:handle', 'organizations:read.assigned', 'catalog:write'];
    await h
      .em()
      .getConnection()
      .execute(`update "admin_roles" set "permissions" = ? where "code" = ?`, [
        JSON.stringify(stale),
        'sales_representative',
      ]);
    const save = (permissions: readonly string[]) =>
      h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/admin-roles/sales_representative',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: {
          code: 'sales_representative',
          name: 'Sales representative',
          permissions: [...permissions],
        },
      });
    const stored = async (): Promise<string[]> => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select "permissions" from "admin_roles" where "code" = ?`, [
          'sales_representative',
        ])) as Array<{ permissions: string[] }>;
      return rows[0]?.permissions ?? [];
    };

    // The defect: the editor sends the stored codes back and is refused.
    expect((await save(await stored())).statusCode).toBe(400);

    await rolesDemo.seed(context);

    // Exactly the retired code is gone; the operator's grant is where it was.
    expect(await stored()).toEqual(['rfqs:handle', 'catalog:write']);
    expect((await save(await stored())).statusCode).toBe(200);
    expect(await demoAdmins()).toEqual(DEMO_ADMINS);
  });

  it('reset: the composition withdrawal leaves every account its role', async () => {
    const result = await adminOnlyComposition().withdraw();
    expect(result.applied).toContain('demo administrators take their roles');

    // The run stops here — no module has removed its rows yet.
    expect(await demoAdmins()).toEqual(DEMO_ADMINS);
  });

  it('reset: the accounts go before the roles they hold, and nothing is left behind', async () => {
    // Reverse dependency order, as the runner resets.
    await usersDemo.reset(context);
    expect(await demoAdmins()).toEqual({});
    await rolesDemo.reset(context);

    const roles = (await h
      .em()
      .getConnection()
      .execute(
        `select "code" from "admin_roles" where "code" in ('platform_admin', 'sales_representative')`,
      )) as Array<{ code: string }>;
    // The demo's own role is withdrawn; the one every instance has is not.
    expect(roles.map((row) => row.code)).toEqual(['platform_admin']);
  });
});
