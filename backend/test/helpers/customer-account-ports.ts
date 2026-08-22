import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountAdminSearchPort,
  CustomerAccountLifecycleWritePort,
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import type { AuditLogService } from '../../src/kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../src/commands/index.js';
import {
  CustomerAccountMemberWriteService,
  CustomerAccountReadService,
} from '../../src/modules/customer_accounts/services/customer-account-ports.js';
import {
  CustomerAccountAdminSearchService,
  CustomerAccountLifecycleWriteService,
} from '../../src/modules/customer_accounts/services/customer-account-lifecycle-ports.js';

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
    read: new CustomerAccountReadService(emFactory),
    write: new CustomerAccountMemberWriteService(emFactory),
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
): CustomerAccountLifecycleWritePort {
  return new CustomerAccountLifecycleWriteService(emFactory, auditLog, commandBus);
}

export function customerAccountAdminSearchFor(
  emFactory: () => EntityManager,
): CustomerAccountAdminSearchPort {
  return new CustomerAccountAdminSearchService(emFactory);
}
