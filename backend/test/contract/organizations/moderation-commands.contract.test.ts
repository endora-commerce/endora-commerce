import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as organizationsManifest } from '../../../../packages/modules/organizations/src/manifest.js';

/**
 * `specs/186-aggregate-ports/` T026 — the four moderation transitions are
 * Commands. Measured against PostgreSQL:
 *
 * 1. the admin route records exactly one `organization.approved` entry, with
 *    the administrator of the request as its actor, and the
 *    `organization.status_changed.v1` event dispatches once;
 * 2. a refused transition records nothing and emits nothing;
 * 3. in `auto` moderation mode, the registration subscriber approves the new
 *    Organization through the same Command, as the `system` actor — the
 *    subscriber runs in the storefront visitor's request, where the bus would
 *    otherwise refuse to run.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

describe('organization moderation as Commands (186 T026)', () => {
  let h: BackendServerHandle;
  const statusChanges: Array<{ organizationId: string; newStatus: string }> = [];
  let off: () => void = () => undefined;

  const entries = async (organizationId: string, action: string) => {
    h.em().clear();
    return h.em().find(AuditLogEntry, { objectType: 'organization', objectId: organizationId, action });
  };

  async function pending(name: string): Promise<Organization> {
    const em = h.em();
    const org = em.create(Organization, {
      name,
      taxId: `PL186${String(Date.now()).slice(-7)}`,
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    });
    await em.persist(org).flush();
    return org;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    off = h.eventBus.on('organization.status_changed.v1' as never, ((payload: { organizationId: string; newStatus: string }) => {
      statusChanges.push({ organizationId: payload.organizationId, newStatus: payload.newStatus });
    }) as never);
  });

  afterAll(async () => {
    off();
    await teardownBackendServer(h);
  });

  it('the admin approval records one entry under the administrator, and emits once', async () => {
    const org = await pending('Moderation Commands 186 A');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${org.id}/approve`,
      cookies: ADMIN,
      payload: { expectedVersion: org.version },
    });
    expect(res.statusCode, res.body).toBe(200);

    const approved = await entries(org.id, 'organization.approved');
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({
      actorAdminUserId: TEST_ADMIN_ID,
      stateBefore: { status: 'pending_verification', approvedByAdminUserId: null },
      stateAfter: { status: 'active', approvedByAdminUserId: TEST_ADMIN_ID },
    });
    expect(statusChanges.filter((e) => e.organizationId === org.id)).toEqual([
      { organizationId: org.id, newStatus: 'active' },
    ]);
  });

  it('a refused transition records nothing and emits nothing', async () => {
    const org = await pending('Moderation Commands 186 B');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${org.id}/block`,
      cookies: ADMIN,
      payload: { expectedVersion: org.version, reason: 'not active yet' },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(await entries(org.id, 'organization.blocked')).toEqual([]);
    expect(statusChanges.filter((e) => e.organizationId === org.id)).toEqual([]);
  });

  it('auto moderation approves a registration through the Command, as the system', async () => {
    await new ManifestReconciler(h.em()).apply([organizationsManifest.settings!]);
    const set = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/organizations.moderation.mode/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: 'auto' },
    });
    expect(set.statusCode, set.body).toBeLessThan(300);
    try {
      const stamp = String(Date.now()).slice(-8);
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/register',
        payload: {
          organization: {
            name: `Auto Moderation 186 ${stamp}`,
            taxId: `PL7${stamp}`,
            registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
          },
          firstUser: {
            email: `auto-moderation-186-${stamp}@example.test`,
            password: 'a-very-strong-password-123!',
            firstName: 'Anna',
            lastName: 'Nowak',
          },
          acceptedTermsVersion: '1.0.0',
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const organizationId = (res.json() as { data: { organization: { id: string } } }).data.organization.id;

      await expect
        .poll(async () => {
          h.em().clear();
          return (await h.em().findOneOrFail(Organization, { id: organizationId })).status;
        })
        .toBe('active');
      const approved = await entries(organizationId, 'organization.approved');
      expect(approved).toHaveLength(1);
      // A null column reads back as `undefined` on the entity.
      expect(approved[0]!.actorAdminUserId ?? null).toBeNull();
      expect(approved[0]).toMatchObject({ stateAfter: { status: 'active', approvedByAdminUserId: null } });
    } finally {
      await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings/organizations.moderation.mode/value',
        cookies: ADMIN,
        payload: { scope: 'all', value: 'manual' },
      });
    }
  });
});
