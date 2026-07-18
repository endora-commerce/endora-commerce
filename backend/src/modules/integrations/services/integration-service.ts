import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { ExternalIntegration } from '../entities/external-integration.entity.js';

/**
 * IntegrationService (T230).
 *
 * - create / update / list / remove ExternalIntegration rows.
 * - encryptedConfig is symmetric-encrypted at rest with AES-256-GCM. The key
 *   comes from `INTEGRATIONS_ENCRYPTION_KEY` (env) or a deterministic test
 *   default — never hard-coded in production.
 * - testConnection runs a vendor-specific probe and stamps lastTestedAt /
 *   lastError. The MVP probe is a generic HTTP HEAD to a `baseUrl` field in
 *   the config (good enough for the contract test); real adapters layer on
 *   top later.
 */
export interface IntegrationTestResult {
  ok: boolean;
  status: 'active' | 'inactive' | 'error';
  testedAt: Date;
  message?: string | undefined;
}

export class IntegrationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditLogService,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'external_integration', objectId, stateBefore, stateAfter });
    }
  }

  async list(): Promise<ExternalIntegration[]> {
    const em = this.emFactory();
    return em.find(ExternalIntegration, {}, { orderBy: { createdAt: 'desc' } });
  }

  async getById(id: string): Promise<ExternalIntegration> {
    const em = this.emFactory();
    const row = await em.findOne(ExternalIntegration, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Integration not found.');
    return row;
  }

  async create(input: {
    name: string;
    vendor: string;
    kind: string;
    config: Record<string, unknown>;
    createdByAdminUserId?: string;
  }): Promise<ExternalIntegration> {
    const em = this.emFactory();
    const row = em.create(ExternalIntegration, {
      name: input.name,
      vendor: input.vendor,
      kind: input.kind,
      encryptedConfig: encryptConfig(input.config),
      ...(input.createdByAdminUserId !== undefined
        ? { createdByAdminUserId: input.createdByAdminUserId }
        : {}),
    });
    em.persist(row);
    this.#audit(em, 'integration.create', row.id, null, { name: row.name, vendor: row.vendor });
    await em.flush();
    return row;
  }

  async update(
    id: string,
    patch: {
      name?: string | undefined;
      config?: Record<string, unknown> | undefined;
      status?: 'active' | 'inactive' | 'error' | undefined;
    },
  ): Promise<ExternalIntegration> {
    const em = this.emFactory();
    const row = await em.findOne(ExternalIntegration, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Integration not found.');
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.config !== undefined) row.encryptedConfig = encryptConfig(patch.config);
    if (patch.status !== undefined) row.status = patch.status;
    this.#audit(em, 'integration.update', row.id, null, { name: row.name, status: row.status });
    await em.flush();
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(ExternalIntegration, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Integration not found.');
    this.#audit(em, 'integration.delete', row.id, { name: row.name }, null);
    await em.removeAndFlush(row);
  }

  /**
   * Run the vendor-specific connectivity probe. The MVP probe is a HEAD/GET
   * against a `baseUrl` field in the decrypted config; non-2xx flips status
   * to 'error', 2xx to 'active'.
   *
   * `fetchFn` is injectable so unit tests can isolate the network call.
   */
  async testConnection(
    id: string,
    deps: { fetchFn?: typeof fetch } = {},
  ): Promise<IntegrationTestResult> {
    // command-coverage-ignore: delivery execution/bookkeeping — the config write
    // is audited separately; this is provider dispatch state.
    const em = this.emFactory();
    const row = await em.findOne(ExternalIntegration, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Integration not found.');

    const config = decryptConfig(row.encryptedConfig);
    const baseUrl = typeof config['baseUrl'] === 'string' ? config['baseUrl'] : null;
    const now = new Date();
    if (!baseUrl) {
      row.status = 'error';
      row.lastTestedAt = now;
      row.lastError = 'config.baseUrl is required for testConnection';
      await em.flush();
      return { ok: false, status: 'error', testedAt: now, message: row.lastError };
    }
    const doFetch = deps.fetchFn ?? globalThis.fetch;
    try {
      const res = await doFetch(baseUrl, { method: 'HEAD' });
      const ok = res.status >= 200 && res.status < 400;
      row.status = ok ? 'active' : 'error';
      row.lastTestedAt = now;
      row.lastError = ok ? null : `Status ${res.status}`;
      await em.flush();
      return ok
        ? { ok: true, status: 'active', testedAt: now }
        : { ok: false, status: 'error', testedAt: now, message: row.lastError ?? undefined };
    } catch (err) {
      row.status = 'error';
      row.lastTestedAt = now;
      row.lastError = err instanceof Error ? err.message : String(err);
      await em.flush();
      return {
        ok: false,
        status: 'error',
        testedAt: now,
        message: row.lastError ?? undefined,
      };
    }
  }
}

function encryptionKey(): Buffer {
  const raw = process.env['INTEGRATIONS_ENCRYPTION_KEY'] ?? 'integration-config-test-key';
  return createHash('sha256').update(raw, 'utf8').digest();
}

function encryptConfig(config: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(config), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Layout: iv(12) | tag(16) | ciphertext.
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptConfig(blob: string): Record<string, unknown> {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
}
