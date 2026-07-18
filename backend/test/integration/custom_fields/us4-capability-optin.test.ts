import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 055 US4 (T040) — a definition carries opaque `config` capability flags
 * that a host module reads through its own extension point; the generic core
 * stores but never interprets them (FR-006) [real DB].
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('Custom Fields — capability opt-in via opaque config (US4) [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('round-trips an opaque config flag without the core interpreting it', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      payload: {
        entityType: 'category',
        key: 'material',
        label: {},
        labelDefault: 'Material',
        valueType: 'text',
        required: false,
        sortOrder: 0,
        // Host-owned capability flag — the custom-fields core stores it verbatim.
        config: { filterable: true, storefrontVisible: true },
        options: [],
      },
      ...ADMIN,
    });
    expect(create.statusCode).toBe(201);

    // A host module reads the flag through the service (its own extension point).
    const defs = await h.customFields.definitionService.listForEntity('category');
    const material = defs.find((d) => d.definition.key === 'material');
    expect(material?.definition.config).toEqual({ filterable: true, storefrontVisible: true });
  });
});
