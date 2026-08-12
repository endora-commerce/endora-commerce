import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

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
 *     degrade the column, not the endpoint. An operator investigating an
 *     incident needs the record more, not less, when part of the platform is
 *     off.
 *  2. The audit log answers on its **own** state. It never gated at all before;
 *     now switching it off refuses it like any other module.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);

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
    actorId = admins[0]?.id ?? randomUUID();
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

  it('keeps answering when admin_users is switched off, with the actor degraded to an id', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['admin_users'] });
    try {
      const entry = await readEntry();
      // The record is the point. Losing the display name is acceptable;
      // losing the audit trail because a *different* module is off is not.
      expect(entry).toBeDefined();
      expect(entry?.['action']).toBe('test.detachment_probe');
      // The id survives — it is on the row. The display name is what the
      // absent module was supplying, so it is what degrades.
      expect(entry?.['actorAdminUserId']).toBe(actorId);
      expect(entry?.['actorName']).toBeNull();
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }
  });

  it('recent activity keeps answering when admin_users is switched off', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['admin_users'] });
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-log/recent-activity',
        cookies: ADMIN,
      });
      expect(res.statusCode).toBe(200);
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }
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
