import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { CredentialConfiguration } from '../../../src/modules/credentials/entities/credential-configuration.entity.js';

/**
 * Feature 058 US1 (T020) — CRUD end-to-end over the real admin routes + DB.
 *
 * create → read (masked) → update (write-only secret preserved on blank) → list;
 * duplicate code rejected; audit rows redact the secret.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CODE = 'crud-llm';

describe('Credentials CRUD [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates, reads masked, updates with write-only secret preservation, and lists', async () => {
    // Create with a secret.
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'CRUD LLM',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'sk-original', model: 'claude-opus-4-8' },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);
    const version1 = (created.json() as { version: number }).version;

    // Secret is stored as an encrypted envelope (never plaintext) in the DB.
    const stored = await h.em().findOneOrFail(CredentialConfiguration, { code: CODE });
    expect(typeof stored.values['apiKey']).toBe('object');
    expect(JSON.stringify(stored.values['apiKey'])).not.toContain('sk-original');
    expect(stored.values['model']).toBe('claude-opus-4-8');

    // The create audit row redacts the secret (FR-014).
    const createAudit = await h.em().findOneOrFail(AuditLogEntry, {
      action: 'credential.create',
      objectId: CODE,
    });
    expect(JSON.stringify(createAudit.stateAfter)).not.toContain('sk-original');
    expect((createAudit.stateAfter as { values: Record<string, unknown> }).values['apiKey']).toBe(
      '[redacted]',
    );

    // Update the model only, leaving the secret field blank → secret preserved.
    const updated = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/credentials/${CODE}`,
      payload: { values: { model: 'claude-sonnet-4-6', apiKey: '[redacted]' }, expectedVersion: version1 },
      ...ADMIN,
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { fields: { key: string; value?: unknown }[] }).fields.find((f) => f.key === 'model')?.value).toBe(
      'claude-sonnet-4-6',
    );

    const afterUpdate = await h.em().fork().findOneOrFail(CredentialConfiguration, { code: CODE });
    // Secret envelope unchanged; model updated.
    expect(afterUpdate.values['apiKey']).toStrictEqual(stored.values['apiKey']);
    expect(afterUpdate.values['model']).toBe('claude-sonnet-4-6');

    // List includes the configuration, masked.
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials?type=llm', ...ADMIN });
    expect(list.statusCode).toBe(200);
    const codes = (list.json().configurations as { code: string }[]).map((c) => c.code);
    expect(codes).toContain(CODE);
    expect(list.body).not.toContain('sk-original');
  });

  it('rejects a duplicate code', async () => {
    const dup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'dup',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'x', model: 'm' },
      },
      ...ADMIN,
    });
    expect(dup.statusCode).toBe(409);
  });

  it('rejects a stale expectedVersion with 409', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/credentials/${CODE}`,
      payload: { name: 'stale', expectedVersion: 0 },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(409);
  });
});
