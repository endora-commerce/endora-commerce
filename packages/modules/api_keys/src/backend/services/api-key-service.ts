import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type ApiKeyBinding,
  type CustomerAccountReadPort,
  type OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ApiKey } from '../entities/api-key.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { AuditPort } from '@endora-commerce/platform/kernel';

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

/**
 * The two owners this module asks about a binding it is being handed
 * (feature 075, D-87).
 *
 * Both reads were `em.getKnex().raw('select … from "organizations" / …
 * "customer_accounts" …')`. Raw SQL names no import specifier, so those two
 * boundary crossings compiled, returned rows and were invisible to the import
 * predicate until feature 077 taught the check to read table identifiers.
 *
 * Nothing about the isolation changes by resolving them as ports: `getKnex()`
 * is `getConnection().getKnex()`, which takes its own pooled connection, so
 * neither read could ever see the enclosing transaction's writes either. What
 * changes is that an absent owner now refuses instead of answering — B3 and B4
 * decide whether a distributor key may be minted, and a validation that
 * silently found no organisation because the module holding organisations was
 * gone would mint nothing and blame the operator's input.
 */
export interface ApiKeyBindingPorts {
  organizations: OrganizationDetailsPort;
  customerAccounts: CustomerAccountReadPort;
}

export class ApiKeyService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly bindingPorts: ApiKeyBindingPorts,
    private readonly auditLog?: AuditPort,
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
   * Creation rules B1–B5 (contracts/api-key-binding.md §2). The two foreign
   * rows are read through their owners' published ports (see
   * {@link ApiKeyBindingPorts}); the sales channel is the kernel's own entity
   * and stays an ORM read on the caller's `em`.
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
      const organization = await this.bindingPorts.organizations.findById(
        input.binding.organizationId,
      );
      // B4. `deletedAt` is checked here rather than assumed of the port: the
      // statement this replaced spelled `and "deleted_at" is null`, and a
      // soft-deleted organisation is a binding target that must not resolve.
      if (organization === null || organization.deletedAt !== null) {
        issues.push({
          path: 'binding.organizationId',
          issue: 'Organization does not exist.',
        });
      }
      /**
       * The kernel's own entity, not `select 1 from "sales_channels"` (feature
       * 075, D-87). `sales_channels` is the kernel's table since feature 072
       * moved the resolution machinery there, and a module relating into the
       * kernel by ORM is the sanctioned access.
       *
       * Read through the caller's `em`, not through
       * `salesChannelResolutionPort.getById`: that accessor forks its own
       * EntityManager, so a channel created earlier in this Command's
       * transaction would not be visible to it and B4 would refuse a binding
       * that is about to be valid.
       */
      const channel = await em.findOne(SalesChannel, { id: input.binding.salesChannelId });
      if (channel === null) {
        // B4 (active not required at creation — the key fails closed while inactive)
        issues.push({
          path: 'binding.salesChannelId',
          issue: 'Sales channel does not exist.',
        });
      }
      // The wider read on purpose: the four columns the statement selected are
      // all on the record, and the three-way "active" predicate below is this
      // module's rule to state, not the port's `activeOnly` shorthand — that
      // one excludes soft-deleted accounts and says nothing about blocked or
      // anonymized ones.
      const account = await this.bindingPorts.customerAccounts.findById(
        input.binding.customerAccountId,
      );
      const accountActive =
        account !== null &&
        account.blockedAt === null &&
        account.deletedAt === null &&
        account.anonymizedAt === null;
      if (!account || !accountActive || account.organizationId !== input.binding.organizationId) {
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
