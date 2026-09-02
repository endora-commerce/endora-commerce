import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PIM_CONNECTOR_REGISTRY_PORT,
  type PimConnectorRegistryPort,
} from '@endora-commerce/contracts';
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

async function setModuleActivation(
  h: BackendServerHandle,
  moduleId: string,
  active: boolean,
): Promise<void> {
  const response = await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/modules/${moduleId}/activation`,
    payload: { active },
    ...ADMIN,
  });
  if (response.statusCode !== 200) {
    throw new Error(
      `activation ${moduleId}=${active} failed: ${response.statusCode} ${response.body}`,
    );
  }
}

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
    // Ergonode defaults to activated in fresh installs; mutual exclusion is
    // operator-axis, so the sibling must be switched off for this assertion.
    await setModuleActivation(h, 'pim_ergonode', false);
    await expect(h.pimConnectorRegistry.assertCanActivate('pim_unopim')).resolves.toBeUndefined();
  });

  it('registers under the contract port name', () => {
    expect(PIM_CONNECTOR_REGISTRY_PORT).toBe('pimConnectorRegistryPort');
    const port: PimConnectorRegistryPort = h.pimConnectorRegistry;
    expect(port).toBeTruthy();
  });
});
