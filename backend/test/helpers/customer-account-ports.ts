import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AuthSessionPort,
  CustomerAccountAdminSearchPort,
  CustomerAccountAnonymizedEventV1,
  CustomerAccountCommandPort,
  CustomerAccountLifecycleWritePort,
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import type { AuditLogService } from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import { getTenantContext, withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import type { Command, CommandBus } from '../../src/commands/index.js';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { PersonalOrganizationService } from '../../../packages/modules/organizations/src/backend/services/personal-organization-service.js';
import { predefinedRoleIdOn } from '../../../packages/modules/organizations/src/backend/services/organization-role-store.js';
// **`dist`, not `src`** (feature 146): these value-import `customer_accounts`'
// `CustomerAccount` entity, and `QuoteRequestAccountPolicy` is
// `@TransitivelyScoped('CustomerAccount', …)`. A second, source-evaluated class
// beside the one the ORM registered out of `dist` is an ambiguity
// `assertTransitiveParentsResolve` refuses at ORM init (precedent: D-160.6.1,
// `orders-neighbour-ports.ts`).
import {
  CustomerAccountMemberWriteService,
  CustomerAccountReadService,
} from '../../../packages/modules/customer_accounts/dist/backend/services/customer-account-ports.js';
import {
  CustomerAccountAdminSearchService,
  CustomerAccountLifecycleWriteService,
} from '../../../packages/modules/customer_accounts/dist/backend/services/customer-account-lifecycle-ports.js';
import { CustomerAccountCommandService } from '../../../packages/modules/customer_accounts/dist/backend/services/customer-account-command-port.js';
import { Organization } from './package-entities.js';
import { predefinedRoleIdOf } from './seed-organization-roles.js';
import { transactionBoundCommandBus } from './sales-channels-service.js';
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
 *
 * `write.create` runs the `customer_account.create` Command since
 * `specs/176-command-hooks-outbox/` (FR-004), so a test that creates an account
 * through it passes the bus; without one the creation refuses.
 */
export function customerAccountPortsFor(
  emFactory: () => EntityManager,
  commandBus?: CommandBus,
): {
  read: CustomerAccountReadPort;
  write: CustomerAccountMemberWritePort;
} {
  return {
    read: new CustomerAccountReadService(emFactory, twoFactorEnrolmentsFor(emFactory, 'customer')),
    write: new CustomerAccountMemberWriteService(
      emFactory,
      twoFactorEnrolmentsFor(emFactory, 'customer'),
      undefined,
      commandBus ? { commandBus } : undefined,
    ),
  };
}

export interface CustomerAccountCommandsForOptions {
  /**
   * The bus to run on; by default the real bus over the test's own transaction
   * ({@link transactionBoundCommandBus}). Pass `events` with it, so the work a
   * Command defers to its commit is deferred on the bus that commits it.
   */
  readonly commandBus?: CommandBus;
  readonly events?: EventBus;
  /**
   * Who the writes are attributed to when the call has no ambient scope: that
   * administrator, or — absent — the `system` actor of a worker.
   */
  readonly actingFor?: string;
  /** `auth`'s sessions, which a block and a deletion end; nothing is ended by default. */
  readonly sessions?: Pick<AuthSessionPort, 'destroyAllForCustomer'>;
  readonly personalOrganizations?: PersonalOrganizationProvisionApi;
  readonly announceAnonymized?: (payload: CustomerAccountAnonymizedEventV1) => Promise<void>;
}

/**
 * `customerAccountCommandPort` for a hand-built service
 * (`specs/186-aggregate-ports/`, issue #1822) — the real implementation, on
 * the real bus over the test's own transaction, so the entry each Command
 * records lands in the rows a `setupTestDb` suite reads and rolls back.
 *
 * A hand-built service is called with no request around it, and the bus
 * refuses to run without a TenantContext; a call outside one is opened in a
 * system scope — acting for `actingFor` when it is given — which is what the
 * admin route's request or the sweep's worker would have supplied.
 */
export function customerAccountCommandsFor(
  emFactory: () => EntityManager,
  auditLog: AuditLogService,
  options: CustomerAccountCommandsForOptions = {},
): CustomerAccountCommandPort {
  const events = options.events ?? new EventBus();
  const bus = options.commandBus ?? transactionBoundCommandBus(emFactory, auditLog, events);
  const reason = 'test: a hand-built customer_accounts write';
  const scoped: Pick<CommandBus, 'run'> = {
    run: <T>(command: Command<T>): Promise<T> => {
      const run = () => bus.run(command);
      if (getTenantContext()) return run();
      return options.actingFor ? withSystemScopeActingFor(options.actingFor, reason, run) : withSystemScope(reason, run);
    },
  };
  const unwired = (): never => {
    throw new Error('customerAccountCommandsFor: the role lookup is not wired for this helper');
  };
  return new CustomerAccountCommandService({
    commandBus: scoped,
    emFactory,
    twoFactorEnrolments: twoFactorEnrolmentsFor(emFactory, 'customer'),
    roles: { findRole: unwired, predefinedRoleId: (organizationId, kind) => predefinedRoleIdOf(emFactory(), organizationId, kind) },
    isPersonal: async (organizationId) => (await emFactory().findOne(Organization, { id: organizationId }))?.isPersonal === true,
    personalOrganizations: options.personalOrganizations ?? personalOrganizationProvisionFor(emFactory),
    sessions: options.sessions ?? { destroyAllForCustomer: async () => undefined },
    afterCommit: (fn) => events.afterScope(fn),
    ...(options.announceAnonymized ? { announceAnonymized: options.announceAnonymized } : {}),
  });
}

/**
 * The account lifecycle port `customers`' hand-built services need
 * (feature 075, Phase C) — again the real implementation. Deprecated since
 * 0.113.0, it delegates to {@link customerAccountCommandsFor}'s port, which is
 * where the entry for a block, a delete or a scrub is recorded, so a stub here
 * would make every one of those assertions vacuous.
 */
export function customerAccountLifecycleWriteFor(
  emFactory: () => EntityManager,
  auditLog: AuditLogService,
  commandBus?: CommandBus,
  personalOrganizations: PersonalOrganizationProvisionApi = personalOrganizationProvisionFor(
    emFactory,
  ),
  options: Omit<CustomerAccountCommandsForOptions, 'commandBus' | 'personalOrganizations'> = {},
): CustomerAccountLifecycleWritePort {
  const twoFactor = twoFactorEnrolmentsFor(emFactory, 'customer');
  return new CustomerAccountLifecycleWriteService(emFactory, auditLog, twoFactor, {
    commands: customerAccountCommandsFor(emFactory, auditLog, {
      ...options,
      ...(commandBus ? { commandBus } : {}),
      personalOrganizations,
    }),
    reads: new CustomerAccountReadService(emFactory, twoFactor),
  });
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
    // The answer carries the new Organization's Administrator role, read on
    // the caller's `em` as the real seam does (`specs/170-organization-roles/` R-34).
    // `specs/193-admin-form-extensions/` D-300.31 — as the caller's child Command, as the real seam runs it.
    provisionFor: async ({ em, run }, input) => {
      const org = await run(service.provisionCommand(input, { child: true }));
      return { id: org.id, administratorRoleId: await predefinedRoleIdOn(em, org.id, 'administrator') };
    },
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
