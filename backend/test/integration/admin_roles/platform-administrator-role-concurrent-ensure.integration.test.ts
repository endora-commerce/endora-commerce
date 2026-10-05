import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installHook } from '@endora-commerce/mod-admin-roles';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Several processes may ensure the platform-administrator role at once.
 *
 * An instance starts an API process and a worker process, and each runs the
 * ensure at boot. On a database that does not hold the role yet they all find
 * nothing and all try to create it; the ones that lose must find the winner's
 * row rather than fail — a failed boot hook stops the process.
 *
 * Entered through the module's published `installHook`, over separate
 * EntityManager forks so the statements run on separate connections.
 */
describe('ensuring the platform-administrator role concurrently', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates exactly one role and fails nobody, on a database that holds none', async () => {
    const conn = h.em().getConnection();
    for (let round = 0; round < 5; round += 1) {
      // The role and the accounts that hold it, and nothing else: the foreign
      // key refuses the first delete while an account still references it.
      await conn.execute(
        `delete from "admin_users" where "admin_role_id" in
           (select "id" from "admin_roles" where "code" = 'platform_admin')`,
      );
      await conn.execute(`delete from "admin_roles" where "code" = 'platform_admin'`);

      const log = { info: (): void => {}, warn: (): void => {}, error: (): void => {} };
      const outcomes = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          installHook({
            em: h.em().fork(),
            redis: undefined,
            log,
            module: { id: 'admin_roles', version: '1.0.0' },
          }),
        ),
      );

      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
      const rows = (await conn.execute(
        `select "permissions" from "admin_roles" where "code" = 'platform_admin'`,
      )) as Array<{ permissions: string[] }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.permissions).toEqual(['*']);
    }
  });
});
