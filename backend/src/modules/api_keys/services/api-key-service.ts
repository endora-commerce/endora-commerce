import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { ApiKey } from '../entities/api-key.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';

/**
 * ApiKeyService (T227).
 *
 * - create: generates a `sk_live_<random>` token, stores its sha256 hash, and
 *   returns the raw token + ApiKey row. Caller must show the token once.
 * - revoke: marks status='revoked', sets revokedAt.
 * - authenticate: hashes the supplied bearer, looks up by hash, validates
 *   status. Returns the ApiKey row or null. Used by the api-key auth gate.
 */

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  /** Raw bearer token. Returned exactly once. */
  bearerToken: string;
}

const TOKEN_PREFIX = 'sk_live_';

export class ApiKeyService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditLogService,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'api_key', objectId, stateBefore, stateAfter });
    }
  }

  async create(input: {
    name: string;
    scopes: string[];
    createdByAdminUserId?: string;
  }): Promise<CreateApiKeyResult> {
    const em = this.emFactory();
    const raw = randomBytes(32).toString('base64url');
    const bearerToken = `${TOKEN_PREFIX}${raw}`;
    const apiKey = em.create(ApiKey, {
      name: input.name,
      keyHash: sha256Hex(bearerToken),
      lastFour: bearerToken.slice(-4),
      scopes: input.scopes,
      ...(input.createdByAdminUserId !== undefined
        ? { createdByAdminUserId: input.createdByAdminUserId }
        : {}),
    });
    em.persist(apiKey);
    this.#audit(em, 'api_key.create', apiKey.id, null, { name: apiKey.name, scopes: apiKey.scopes });
    await em.flush();
    return { apiKey, bearerToken };
  }

  async list(): Promise<ApiKey[]> {
    const em = this.emFactory();
    return em.find(ApiKey, {}, { orderBy: { createdAt: 'desc' } });
  }

  async revoke(apiKeyId: string): Promise<void> {
    const em = this.emFactory();
    const apiKey = await em.findOne(ApiKey, { id: apiKeyId });
    if (!apiKey) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'API key not found.');
    }
    apiKey.status = 'revoked';
    apiKey.revokedAt = new Date();
    this.#audit(em, 'api_key.revoke', apiKey.id, { name: apiKey.name }, null);
    await em.flush();
  }

  /**
   * Resolve a raw bearer token to an ApiKey row. Returns null if invalid /
   * revoked. Updates `lastUsedAt` on success.
   */
  async authenticate(rawBearer: string): Promise<{ apiKeyId: string; scopes: string[] } | null> {
    // command-coverage-ignore: stamps last-used — high-volume auth bookkeeping,
    // not an audited domain-state mutation.
    if (!rawBearer.startsWith(TOKEN_PREFIX)) return null;
    const em = this.emFactory();
    const apiKey = await em.findOne(ApiKey, { keyHash: sha256Hex(rawBearer) });
    if (!apiKey || apiKey.status !== 'active') return null;
    apiKey.lastUsedAt = new Date();
    await em.flush();
    return { apiKeyId: apiKey.id, scopes: apiKey.scopes };
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
