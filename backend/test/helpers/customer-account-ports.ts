import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountAdminSearchPort,
  CustomerAccountLifecycleWritePort,
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import type { AuditLogService } from '@endora-commerce/platform/composition';
import type { CommandBus } from '../../src/commands/index.js';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { PersonalOrganizationService } from '../../../packages/modules/organizations/src/backend/services/personal-organization-service.js';
import {
  CustomerAccountMemberWriteService,
  CustomerAccountReadService,
} from '../../../packages/modules/customer_accounts/src/backend/services/customer-account-ports.js';
import {
  CustomerAccountAdminSearchService,
  CustomerAccountLifecycleWriteService,
} from '../../../packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.js';
import { twoFactorEnrolmentsFor } from './two-factor-enrolments.js';

/**
 * The two `customer_accounts` ports a hand-built `organizations` service needs
 * (feature 075, Phase C).
 *
 * The **real** implementations rather than stubs: they are the same classes
 * the container registers, so a test that builds a service by hand exercises
 * the same write path the composed one does. What the container adds on top is
 * the effective-state gate, and a test that wants the 503 flips the module
 * state against the shared harness instead of substituting a fake here.
 */
export function customerAccountPortsFor(emFactory: () => EntityManager): {
  read: CustomerAccountReadPort;
  write: CustomerAccountMemberWritePort;
} {
  return {
    read: new CustomerAccountReadService(emFactory, twoFactorEnrolmentsFor(emFactory, 'customer')),
    write: new CustomerAccountMemberWriteService(
      emFactory,
      twoFactorEnrolmentsFor(emFactory, 'customer'),
    ),
  };
}

/**
 * The account lifecycle port `customers`' hand-built services need
 * (feature 075, Phase C) — again the real implementation, for the reason
 * above: it is where the audit row for a block, a delete or a scrub is
 * written, so a stub here would make every one of those assertions vacuous.
 */
export function customerAccountLifecycleWriteFor(
  emFactory: () => EntityManager,
  auditLog: AuditLogService,
  commandBus?: CommandBus,
  personalOrganizations: PersonalOrganizationProvisionApi = personalOrganizationProvisionFor(
    emFactory,
  ),
): CustomerAccountLifecycleWritePort {
  return new CustomerAccountLifecycleWriteService(
    emFactory,
    auditLog,
    twoFactorEnrolmentsFor(emFactory, 'customer'),
    personalOrganizations,
    commandBus,
  );
}

/**
 * D-178 — `organizations`' co-transactional provisioning seam, the real
 * implementation, for the same reason the two ports above are real: it is what
 * makes `createStandalone` write the account **and** its personal organisation
 * in one transaction, and a stub here would make every assertion about that
 * atomicity vacuous.
 *
 * It needs neither of `customer_accounts`' ports — `provisionFor` reads and
 * writes only `organizations`' own table — so the `PersonalOrganizationService`
 * built here is handed a pair that throws if anything ever reaches for one.
 */
export function personalOrganizationProvisionFor(
  emFactory: () => EntityManager,
): PersonalOrganizationProvisionApi {
  const unreachable = (): never => {
    throw new Error('provisionFor touches no customer_accounts port');
  };
  const service = new PersonalOrganizationService(emFactory, {
    read: new Proxy({} as CustomerAccountReadPort, { get: unreachable }),
    write: new Proxy({} as CustomerAccountMemberWritePort, { get: unreachable }),
  });
  return {
    provisionFor: async (em, input) => ({ id: (await service.provisionFor(em, input)).id }),
  };
}

export function customerAccountAdminSearchFor(
  emFactory: () => EntityManager,
): CustomerAccountAdminSearchPort {
  return new CustomerAccountAdminSearchService(
    emFactory,
    twoFactorEnrolmentsFor(emFactory, 'customer'),
  );
}
