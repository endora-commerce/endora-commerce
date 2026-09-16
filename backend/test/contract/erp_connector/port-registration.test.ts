import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERP_CONNECTOR_REGISTRY_PORT,
  type ErpConnectorRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('erp_connector — registry port [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resolves erpConnectorRegistryPort from the composed container', () => {
    const port = h.erpConnectorRegistry;
    expect(port).toBeDefined();
    expect(typeof port.assertCanActivate).toBe('function');
    expect(typeof port.getActiveModuleId).toBe('function');
  });

  it('registers under the contract port name', () => {
    expect(ERP_CONNECTOR_REGISTRY_PORT).toBe('erpConnectorRegistryPort');
    const port: ErpConnectorRegistryPort = h.erpConnectorRegistry;
    expect(port).toBeTruthy();
  });
});
