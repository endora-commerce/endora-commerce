import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAPABILITY_KEYS,
  PIM_CONNECTOR_REGISTRY_PORT,
  type PimConnectorRegistryPort,
} from '@endora-commerce/contracts';
import { clearFamilyFor, declaredMembersOf } from '../../helpers/capability-families.js';
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
    //
    // The subject is derived too. It named `pim_unopim` until that module left
    // for the paid repository (feature 134), and a module id no manifest declares
    // is not a PIM connector this registry can be asked about: the case would
    // have gone on asserting over a name, not a member. Any member proves the
    // port's answer, so the first one the manifests declare is the subject.
    const [subject] = declaredMembersOf(CAPABILITY_KEYS.PIM_CONNECTOR);
    expect(subject, 'the composed deployment declares no PIM connector').toBeDefined();
    await clearFamilyFor(h, subject!);
    await expect(h.pimConnectorRegistry.assertCanActivate(subject!)).resolves.toBeUndefined();
  });

  it('registers under the contract port name', () => {
    expect(PIM_CONNECTOR_REGISTRY_PORT).toBe('pimConnectorRegistryPort');
    const port: PimConnectorRegistryPort = h.pimConnectorRegistry;
    expect(port).toBeTruthy();
  });
});
