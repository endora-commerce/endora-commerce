import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ApiKeyBinding } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { ApiKey } from '../entities/api-key.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

/**
 * ApiKeyService (T227, extended by feature 062 — distributor binding).
 *
 * - create: generates a `sk_live_<random>` token, stores its sha256 hash, and
 *   returns the raw token + ApiKey row. Caller must show the token once.
 *   Validates the distributor binding rules B1–B5
 *   (specs/062-distributor-api/contracts/api-key-binding.md §2).
 * - revoke: marks status='revoked', sets revokedAt.
 * - authenticate: hashes the supplied bearer, looks up by hash, validates
 *   status + expiry. Returns the resolved identity (incl. binding) or null.
 *   Used by the api-key auth gates and the ambient actor resolver.
 */

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  /** Raw bearer token. Returned exactly once. */
  bearerToken: string;
}

/** Resolved identity of an authenticated key, incl. the distributor binding. */
export interface AuthenticatedApiKey {
  apiKeyId: string;
  scopes: string[];
  organizationId: string | null;
  salesChannelId: string | null;
  customerAccountId: string | null;
}

const TOKEN_PREFIX = 'sk_live_';

type ValidationIssue = { path: string; issue: string };

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
    binding?: ApiKeyBinding;
    expiresAt?: Date;
    createdByAdminUserId?: string;
  }): Promise<CreateApiKeyResult> {
    const em = this.emFactory();
    await this.#validateCreate(em, input);

    const raw = randomBytes(32).toString('base64url');
    const bearerToken = `${TOKEN_PREFIX}${raw}`;
    const apiKey = em.create(ApiKey, {
      name: input.name,
      keyHash: sha256Hex(bearerToken),
      lastFour: bearerToken.slice(-4),
      scopes: input.scopes,
      ...(input.binding
        ? {
            organizationId: input.binding.organizationId,
            salesChannelId: input.binding.salesChannelId,
            customerAccountId: input.binding.customerAccountId,
          }
        : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.createdByAdminUserId !== undefined
        ? { createdByAdminUserId: input.createdByAdminUserId }
        : {}),
    });
    em.persist(apiKey);
    this.#audit(em, 'api_key.create', apiKey.id, null, {
      name: apiKey.name,
      scopes: apiKey.scopes,
      binding: input.binding
        ? {
            organizationId: input.binding.organizationId,
            salesChannelId: input.binding.salesChannelId,
            customerAccountId: input.binding.customerAccountId,
          }
        : null,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    });
    await em.flush();
    return { apiKey, bearerToken };
  }

  /**
   * Creation rules B1–B5 (contracts/api-key-binding.md §2). Cross-row checks
   * are raw single-row lookups by primary key — the referenced rows are
   * admin-managed platform configuration, and the caller is a platform admin
   * (`integrations:manage`); the same wiring-level pattern is used by e.g. the
   * promotions org-status resolver.
   */
  async #validateCreate(
    em: EntityManager,
    input: { scopes: string[]; binding?: ApiKeyBinding; expiresAt?: Date },
  ): Promise<void> {
    const issues: ValidationIssue[] = [];
    const hasOrdersScope = input.scopes.some((s) => s.startsWith('orders:'));

    if (hasOrdersScope && !input.binding) {
      // B1
      issues.push({
        path: 'binding',
        issue: 'Orders scopes require a distributor binding (organization, sales channel, service account).',
      });
    }
    if (input.binding && input.scopes.includes('catalog:write')) {
      // B2
      issues.push({
        path: 'scopes',
        issue: 'catalog:write is not allowed on a bound key — PIM writes stay unbound-only.',
      });
    }

    if (input.binding) {
      const knex = em.getKnex();
      const orgRes = (await knex.raw(
        `select 1 from "organizations" where "id" = ? and "deleted_at" is null`,
        [input.binding.organizationId],
      )) as { rows: unknown[] };
      if (orgRes.rows.length === 0) {
        // B4
        issues.push({
          path: 'binding.organizationId',
          issue: 'Organization does not exist.',
        });
      }
      const channelRes = (await knex.raw(
        `select 1 from "sales_channels" where "id" = ?`,
        [input.binding.salesChannelId],
      )) as { rows: unknown[] };
      if (channelRes.rows.length === 0) {
        // B4 (active not required at creation — the key fails closed while inactive)
        issues.push({
          path: 'binding.salesChannelId',
          issue: 'Sales channel does not exist.',
        });
      }
      const accountRes = (await knex.raw(
        `select "organization_id", "blocked_at", "deleted_at", "anonymized_at"
           from "customer_accounts" where "id" = ?`,
        [input.binding.customerAccountId],
      )) as {
        rows: Array<{
          organization_id: string | null;
          blocked_at: Date | null;
          deleted_at: Date | null;
          anonymized_at: Date | null;
        }>;
      };
      const account = accountRes.rows[0];
      const accountActive =
        account !== undefined &&
        account.blocked_at === null &&
        account.deleted_at === null &&
        account.anonymized_at === null;
      if (!account || !accountActive || account.organization_id !== input.binding.organizationId) {
        // B3
        issues.push({
          path: 'binding.customerAccountId',
          issue: 'Service account must be an active customer account of the bound organization.',
        });
      }
    }

    if (input.expiresAt !== undefined && input.expiresAt.getTime() <= Date.now()) {
      // B5
      issues.push({ path: 'expiresAt', issue: 'Expiry must be a future instant.' });
    }

    if (issues.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'API key creation failed binding validation.',
        issues,
      );
    }
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
   * Resolve a raw bearer token to the key's identity. Returns null if
   * invalid / revoked / expired. Updates `lastUsedAt` on success.
   */
  async authenticate(rawBearer: string): Promise<AuthenticatedApiKey | null> {
    // command-coverage-ignore: stamps last-used — high-volume auth bookkeeping,
    // not an audited domain-state mutation.
    if (!rawBearer.startsWith(TOKEN_PREFIX)) return null;
    const em = this.emFactory();
    const apiKey = await em.findOne(ApiKey, { keyHash: sha256Hex(rawBearer) });
    if (!apiKey || apiKey.status !== 'active') return null;
    // Feature 062 (B5 runtime half) — an expired key is indistinguishable from
    // an invalid one (401 UNAUTHORIZED at every gate).
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) return null;
    apiKey.lastUsedAt = new Date();
    await em.flush();
    return {
      apiKeyId: apiKey.id,
      scopes: apiKey.scopes,
      organizationId: apiKey.organizationId ?? null,
      salesChannelId: apiKey.salesChannelId ?? null,
      customerAccountId: apiKey.customerAccountId ?? null,
    };
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
