import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PIM_CONNECTOR_REGISTRY_PORT,
  type PimConnectorRegistryPort,
} from '@endora-commerce/contracts';
import { clearFamilyFor } from '../../helpers/capability-families.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 089 / T023 — `pimConnectorRegistryPort` is registered and reachable
 * when `pim_connector` is composed.
 *
 * `pim_connector` is non-deactivatable on the operator axis; gating on platform
 * withdrawal is covered by the kernel port-fail-closed contract suite.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('pim_connector — registry port [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resolves pimConnectorRegistryPort from the composed container', () => {
    const port = h.pimConnectorRegistry;
    expect(port).toBeDefined();
    expect(typeof port.assertCanActivate).toBe('function');
    expect(typeof port.getActiveModuleId).toBe('function');
  });

  it('assertCanActivate passes when no sibling PIM connector is active', async () => {
    // The harness activates every module, and mutual exclusion is operator-axis, so
    // every sibling has to be switched off for this assertion. Derived rather than
    // named: this line used to switch off `pim_ergonode` alone, which was the whole
    // family when it was written and is a quarter of it now (feature 132).
    await clearFamilyFor(h, 'pim_unopim');
    await expect(h.pimConnectorRegistry.assertCanActivate('pim_unopim')).resolves.toBeUndefined();
  });

  it('registers under the contract port name', () => {
    expect(PIM_CONNECTOR_REGISTRY_PORT).toBe('pimConnectorRegistryPort');
    const port: PimConnectorRegistryPort = h.pimConnectorRegistry;
    expect(port).toBeTruthy();
  });
});
