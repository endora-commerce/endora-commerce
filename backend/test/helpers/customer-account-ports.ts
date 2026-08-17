import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountMemberWritePort, CustomerAccountReadPort } from '@b2b/contracts';
import {
  CustomerAccountMemberWriteService,
  CustomerAccountReadService,
} from '../../src/modules/customer_accounts/services/customer-account-ports.js';

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
