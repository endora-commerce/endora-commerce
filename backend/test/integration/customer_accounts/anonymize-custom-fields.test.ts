import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountAnonymizedEventV1 } from '@endora-commerce/contracts';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { personalOrganizationProvisionFor } from '../../helpers/customer-account-ports.js';
import { twoFactorEnrolmentsFor } from '../../helpers/two-factor-enrolments.js';
import { CustomerAuthorityService } from '../../../../packages/modules/customers/src/backend/services/customer-authority-service.js';
import { CustomerDeletionService } from '../../../../packages/modules/customers/src/backend/services/customer-deletion-service.js';
import type { OrganizationDepletionGuard } from '../../../../packages/modules/customers/src/backend/services/organization-depletion-guard.js';
// `dist`, not `src` (feature 146) — see `test/helpers/customer-account-ports.ts`.
import {
  CustomerAccountMemberWriteService,
  CustomerAccountReadService,
} from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-ports.js';
import { CustomerAccountLifecycleWriteService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-lifecycle-ports.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-041, FR-042, SC-008):
 * a buyer who typed a phone number into a registration field and is later
 * deleted is scrubbed of it by the retention sweep — the account reads an
 * empty bag, and neither an audit row nor the anonymisation event carries the
 * number at any point of the account's life.
 */
const PHONE = '+48 600 175 008';

describe('customer account anonymisation clears custom-field values (feature 175)', () => {
  let db: TestDb;
  let em: EntityManager;
  let emitted: CustomerAccountAnonymizedEventV1[];
  let audit: AuditLogService;
  let members: CustomerAccountMemberWriteService;
  let lifecycle: CustomerAccountLifecycleWriteService;
  let sweep: CustomerDeletionService;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    emitted = [];
    audit = new AuditLogService(() => em);
    const twoFactor = twoFactorEnrolmentsFor(() => em, 'customer');
    members = new CustomerAccountMemberWriteService(() => em, twoFactor, audit);
    lifecycle = new CustomerAccountLifecycleWriteService(
      () => em,
      audit,
      twoFactor,
      personalOrganizationProvisionFor(() => em),
      undefined,
      async (payload) => {
        emitted.push(payload);
      },
    );
    const organizationRoles = {
      predefinedRoleId: (organizationId: string, kind: 'administrator' | 'member') =>
        predefinedRoleIdOf(em, organizationId, kind),
    };
    sweep = new CustomerDeletionService(
      new CustomerAccountReadService(() => em, twoFactor, organizationRoles),
      lifecycle,
      {
        ensureForCustomerAccount: async () => {
          throw new Error('not reached by the sweep');
        },
        provisionPersonalOrganization: async () => {
          throw new Error('not reached by the sweep');
        },
        // A company Organization: the sweep scrubs the account and leaves it.
        anonymizeIfOrphaned: async () => null,
      },
      new CustomerAuthorityService({ canSeeOrganization: async () => true }),
      { destroyAllForCustomer: async () => undefined },
      { wouldLeaveWithoutAdministrator: async () => false } as unknown as OrganizationDepletionGuard,
      { anonymizeForOrganization: async () => 0 },
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('the retention sweep leaves an empty bag and no trace of the value', async () => {
    const org = await seedAdHocOrganization(em, 'Anonymise CF Org');
    const created = await members.create({
      organizationId: org.id,
      email: `cf-anon-${Date.now()}@example.test`,
      password: 'a-very-strong-pass',
      firstName: 'Phone',
      lastName: 'Holder',
      organizationRoleId: await predefinedRoleIdOf(em, org.id, 'member'),
      customFieldValues: { phone: PHONE },
    });
    expect(created.customFieldValues).toEqual({ phone: PHONE });

    await sweep.softDelete(created.id, {
      adminUserId: '00000000-0000-4000-8000-00000000b175',
      isPlatformAdmin: true,
    });
    const count = await sweep.sweep(0, new Date(Date.now() + 60_000));
    expect(count).toBe(1);

    em.clear();
    const reloaded = await em.findOneOrFail(CustomerAccount, { id: created.id });
    expect(reloaded.anonymizedAt).not.toBeNull();
    expect(reloaded.customFieldValues).toEqual({});

    const rows = await em.find(AuditLogEntry, { objectId: created.id });
    expect(rows.map((r) => r.action)).toContain('customer_account.anonymized');
    for (const row of rows) {
      expect(JSON.stringify(row.stateBefore ?? null)).not.toContain(PHONE);
      expect(JSON.stringify(row.stateAfter ?? null)).not.toContain(PHONE);
    }

    expect(emitted).toHaveLength(1);
    expect(JSON.stringify(emitted[0])).not.toContain(PHONE);
  });
});
