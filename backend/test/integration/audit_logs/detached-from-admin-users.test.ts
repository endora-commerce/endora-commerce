import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 072 wave 1 (T084) — `audit_logs` stops being a passenger of
 * `admin_users`.
 *
 * The module owns two route files and a service, and registered none of them:
 * `admin_users/plugin.ts` imported both route modules, constructed
 * `RecentActivityService` itself, and mounted the lot inside its own plugin. So
 * the audit log — the platform's compliance surface — existed only for as long
 * as the admin-users module happened to be composed, and Principle I's "design
 * every module so it can be detached" was false for it in the most literal way.
 *
 * Two properties follow from giving it its own seam, and they pull in opposite
 * directions, which is why both are here:
 *
 *  1. The audit log survives `admin_users` going away. Actor enrichment — a
 *     name and an e-mail instead of a bare id — is cosmetic, so losing it must
 *     degrade the column, not the endpoint.
 *  2. The audit log answers on its **own** state. It never gated at all before;
 *     now switching it off refuses it like any other module.
 *
 * **Issue #198 — how far property 1 actually reaches.** This file used to
 * assert that `GET /admin/audit-log` answers `200` while `admin_users` is
 * platform-absent, with the actor column degraded to a bare id. It stopped
 * being true on 2026-08-17, when feature 075 Phase C cut `admin_roles`' last
 * read of the `AdminUser` **entity** and replaced it with `adminUserReadPort`
 * (`admin_roles/services/permission-service.ts`). `requireAdmin` asks
 * `PermissionService.hasPermission`, which starts from the admin row — the role
 * assignment is a column `admin_users` owns — so with the owner absent the
 * question "may this admin read the audit log?" has no answer and the gate on
 * the port refuses, before any handler runs.
 *
 * That refusal is the correct behaviour and the old expectation was the
 * defective one: it was only ever satisfiable because a module the platform
 * said was not installed was still supplying authorisation data across a
 * boundary, which is precisely the fail-open the port gate exists to prevent.
 * The reachable half of property 1 is what is asserted below instead — the
 * refusal names `admin_users` rather than `audit_logs`, the rows are untouched
 * by it, and the enrichment source is a gate the read is written to absorb.
 *
 * The unreachable half is worth stating plainly, because the comment in
 * `audit_logs/backend.ts` still promises it: an operator investigating an
 * incident cannot read the audit log through the admin API while `admin_users`
 * is gone, for the same reason they cannot log in. What survives `admin_users`
 * is the module, the routes, the rows and the write path — not an
 * admin-authenticated read.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);

/** The envelope shape both refusals are read out of. */
interface ModuleDisabledEnvelope {
  error: { code: string; details?: { module?: string } };
}

describe('audit_logs — owns its surface [integration]', () => {
  let h: BackendServerHandle;
  let actorId: string;
  let objectId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    // A record with a *known* actor, so "enriched" and "degraded" are
    // distinguishable rather than both being an absent field.
    const em = h.em();
    const admins = await em.execute<Array<{ id: string }>>(
      'select id from admin_users limit 1',
    );
    // Issue #159 — this used to fall back to `randomUUID()`, which defeated the
    // comment above it: an unseeded `admin_users` produced an id matching no
    // row, so the "enriched" case silently became the degraded one and the test
    // asserted the same thing twice. `setupBackendServer` seeds the admins, so
    // absence is a broken harness and says so.
    const seededAdmin = admins[0];
    if (!seededAdmin) {
      throw new Error('setupBackendServer seeds admin_users; none found — the harness is broken.');
    }
    actorId = seededAdmin.id;
    objectId = randomUUID();
    em.create(AuditLogEntry, {
      actorAdminUserId: actorId,
      action: 'test.detachment_probe',
      objectType: 'probe',
      objectId,
    });
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  async function readEntry(): Promise<Record<string, unknown> | undefined> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${objectId}`,
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>> };
    return body.data[0];
  }

  it('enriches the actor column while admin_users is present', async () => {
    const entry = await readEntry();
    expect(entry).toBeDefined();
    expect(entry?.['actorAdminUserId']).toBe(actorId);
    expect(entry?.['actorEmail']).toBeTruthy();
    expect(entry?.['actorName']).toBeTruthy();
  });

  it('refuses both reads while admin_users is absent, naming admin_users', async () => {
    // The **platform** axis, not the operator one. `admin_users` declares
    // itself non-deactivatable — it owns admin login, so an operator switching
    // it off would lock everyone out, including out of the control that
    // switches it back — and `isPresent` therefore ignores the operator axis
    // for it.
    //
    // The refusal is the assertion, and *which module it names* is the point:
    // `audit_logs` is present and its routes are mounted. What is missing is
    // the admin identity the permission check reads, so an operator is told to
    // restore `admin_users` rather than being sent looking at a compliance
    // surface that never went anywhere (issue #161 put the id on the wire for
    // exactly this).
    await withModuleOff('admin_users', 'platform-unavailable', async () => {
      for (const url of [
        `/api/v1/admin/audit-log?filter[objectId]=${objectId}`,
        '/api/v1/admin/audit-log/recent-activity',
      ]) {
        const res = await h.app.inject({ method: 'GET', url, cookies: ADMIN });
        expect(res.statusCode, url).toBe(503);
        const body = res.json() as ModuleDisabledEnvelope;
        expect(body.error.code, url).toBe('MODULE_DISABLED');
        expect(body.error.details?.module, url).toBe('admin_users');
      }
    });

    // The refusal took nothing with it: the row is still there, and the column
    // the absent module was enriching comes back with it. That is the half of
    // "the audit log survives `admin_users`" this seam can still deliver.
    const entry = await readEntry();
    expect(entry).toBeDefined();
    expect(entry?.['action']).toBe('test.detachment_probe');
    expect(entry?.['actorAdminUserId']).toBe(actorId);
    expect(entry?.['actorName']).toBeTruthy();
  });

  it('gates the actor enrichment rather than letting it answer from an absent module', async () => {
    // `auditActorResolver` is the name `audit_logs` owns and defaults to
    // absent; a composition root contributes an adapter over `admin_users`'
    // `adminUserService`, whose port gate is what makes the enrichment
    // withdraw. The route's read absorbs exactly this rejection and falls back
    // to the raw id (`audit_logs/backend.ts`), so this is the input that
    // degrade is written for — asserted directly, because the guard now
    // refuses the request before the handler can demonstrate it.
    const resolveActors = (
      h.container.cradle as unknown as {
        auditActorResolver: (ids: string[]) => Promise<unknown>;
      }
    ).auditActorResolver;
    expect(typeof resolveActors).toBe('function');
    await expect(
      withModuleOff('admin_users', 'platform-unavailable', () => resolveActors([actorId])),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
    // And it answers again once the module is back — the withdrawal is a gate,
    // not a broken registration.
    await expect(resolveActors([actorId])).resolves.toBeDefined();
  });

  it('is absent on both axes while off, and fully restored when on', async () => {
    await expectModuleAbsent(h, 'audit_logs', {
      routes: [
        { url: '/api/v1/admin/audit-log', cookies: ADMIN },
        { url: '/api/v1/admin/audit-log/recent-activity', cookies: ADMIN },
      ],
      adminPresence: { cookies: ADMIN },
    });
  });
});
