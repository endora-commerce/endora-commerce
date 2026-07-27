import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * Feature 058 US4 (T050) — every credential write records exactly one audit row
 * (actor + before/after), with secret values REDACTED (FR-014).
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CODE = 'audit-llm';

describe('Credentials audit [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records one redacted audit row per create / update / delete', async () => {
    // Create.
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'Audit LLM',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'sk-audit-create', model: 'm1' },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);
    const version = (created.json() as { version: number }).version;

    // Update.
    const updated = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/credentials/${CODE}`,
      payload: { values: { apiKey: 'sk-audit-update', model: 'm2' }, expectedVersion: version },
      ...ADMIN,
    });
    expect(updated.statusCode).toBe(200);

    // Delete.
    const deleted = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/credentials/${CODE}`, ...ADMIN });
    expect(deleted.statusCode).toBe(204);

    const em = h.em();
    for (const action of ['credential.create', 'credential.update', 'credential.delete']) {
      const rows = await em.find(AuditLogEntry, { action, objectId: CODE });
      expect(rows, `exactly one ${action} audit row`).toHaveLength(1);
      const row = rows[0]!;
      expect(row.objectType).toBe('credential_configuration');
      expect(row.actorAdminUserId).toBe(TEST_ADMIN_ID);
      // No plaintext secret leaks into either audit state.
      const blob = JSON.stringify({ before: row.stateBefore, after: row.stateAfter });
      expect(blob).not.toContain('sk-audit-create');
      expect(blob).not.toContain('sk-audit-update');
    }

    // The create/update after-state redacts the secret to the mask.
    const createRow = await em.findOneOrFail(AuditLogEntry, { action: 'credential.create', objectId: CODE });
    expect((createRow.stateAfter as { values: Record<string, unknown> }).values['apiKey']).toBe('[redacted]');
    const updateRow = await em.findOneOrFail(AuditLogEntry, { action: 'credential.update', objectId: CODE });
    expect((updateRow.stateBefore as { values: Record<string, unknown> }).values['apiKey']).toBe('[redacted]');
    expect((updateRow.stateAfter as { values: Record<string, unknown> }).values['apiKey']).toBe('[redacted]');
  });
});
