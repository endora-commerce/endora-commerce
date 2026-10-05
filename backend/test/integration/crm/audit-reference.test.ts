import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { createCrmOpportunity, restoreDefaultCrmWorkflow, seedCrmOrganization } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * What a `crm_opportunity` audit row is called and where the admin shows it
 * (User Story 14; `contracts/events-and-ports.md` §5 — the `contributes-to`
 * edge into `audit_logs`).
 *
 * CRM pushes one resolver into `auditReferenceRegistry` from a contribution-only
 * boot hook. The dashboard's recent activity then names an Opportunity by its
 * number and title and links to its screen. The registry skips a contributor
 * that is not effectively present, so with `crm` off there is no label and no
 * link into a screen that would not open.
 */
describe('crm audit reference (User Story 14)', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;

  const registry = () => h.container.resolve<AuditReferenceRegistryPort>('auditReferenceRegistry');
  const as = <T>(scope: { allowAll: boolean; allowedOrganizationIds: string[] }, body: () => Promise<T>) =>
    runWithTenantContext(resolveTenantContext({ kind: 'admin', adminUserId: TEST_ADMIN_ID }, scope), body);
  const PLATFORM = { allowAll: true, allowedOrganizationIds: [] };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Audit A');
    organizationB = await seedCrmOrganization(h.em(), 'Audit B');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is registered by the module’s own boot hook', () => {
    expect(registry().owners()).toContain('crm');
  });

  it('resolves an Opportunity to its number and title, and to its own screen', async () => {
    const opportunity = await createCrmOpportunity(h, { title: 'Fleet renewal', organizationId: organizationA });
    const labels = await as(PLATFORM, () =>
      registry().resolve('crm_opportunity', [opportunity.id, '00000000-0000-4000-8000-00000000dead']),
    );
    expect([...labels.entries()]).toEqual([
      [
        opportunity.id,
        {
          id: opportunity.id,
          label: 'Fleet renewal',
          url: `/crm/opportunities/${opportunity.id}`,
        },
      ],
    ]);
  });

  it('does not name an Opportunity of an Organization the reader is not allowed to see', async () => {
    const mine = await createCrmOpportunity(h, { title: 'Mine', organizationId: organizationA });
    const theirs = await createCrmOpportunity(h, { title: 'Theirs', organizationId: organizationB });
    const scope = { allowAll: false, allowedOrganizationIds: [organizationA] };
    const labels = await as(scope, () => registry().resolve('crm_opportunity', [mine.id, theirs.id]));
    // Positive control first: the confined reader does get their own.
    expect(labels.get(mine.id)?.label).toContain('Mine');
    expect(labels.has(theirs.id)).toBe(false);
    expect((await as(PLATFORM, () => registry().resolve('crm_opportunity', [theirs.id]))).has(theirs.id)).toBe(true);
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'resolves nothing while crm is %s, and again afterwards',
    async (axis) => {
      const opportunity = await createCrmOpportunity(h, { title: 'Off and on', organizationId: organizationA });
      const resolve = () => as(PLATFORM, () => registry().resolve('crm_opportunity', [opportunity.id]));
      expect((await resolve()).size).toBe(1);
      await withModuleOff('crm', axis, async () => {
        expect((await resolve()).size).toBe(0);
      });
      expect((await resolve()).size).toBe(1);
    },
  );
});
