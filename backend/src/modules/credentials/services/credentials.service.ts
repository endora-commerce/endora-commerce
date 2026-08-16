import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type ConfigurationDto,
  type ConfigurationReference,
  type ConfigurationTypeDescriptor,
  type CreateConfiguration,
  type ResolveResult,
  type UpdateConfiguration,
} from '@b2b/contracts';
import type { CommandBus } from '../../../commands/index.js';
import { HttpError } from '../../../http/error-envelope.js';
import { CredentialConfiguration } from '../entities/credential-configuration.entity.js';
import type { ConfigurationTypeRegistry } from './configuration-type-registry.js';
import { maskSecrets } from './field-validator.js';
import { decryptSecretValue, secretValueIsSet } from './secret-value-codec.js';
import { makeCreateConfigurationCommand } from '../commands/create-configuration.command.js';
import { makeUpdateConfigurationCommand } from '../commands/update-configuration.command.js';
import { makeDeleteConfigurationCommand } from '../commands/delete-configuration.command.js';

/**
 * Narrow settings port — the ONLY channel through which credentials reaches the
 * settings module (Principle I). Backs the delete-integrity lookup (FR-012).
 */
export interface CredentialsSettingsPort {
  listReferencesToConfiguration(configurationCode: string): Promise<ConfigurationReference[]>;
}

/**
 * CredentialsService (feature 058) — the module's read + orchestration surface.
 *
 * All writes go through the Command Bus (Principle XIII); every read returns a
 * MASKED DTO (secrets never leave as plaintext, SC-003 / FR-005). A configuration
 * whose `typeCode` is no longer registered is surfaced `inert` (read-only,
 * FR-016).
 *
 * Principle XIV — the core is type-agnostic: it reads a descriptor ONLY to
 * render fields, derive the write-validator, and learn which fields are
 * `secret`. It MUST NOT branch on a specific `typeCode`/`providerCode` for
 * business meaning (provider meaning lives with the consumer). This invariant
 * is grep-asserted in `test/integration/credentials/registry-extensibility.test.ts`.
 */
export interface CredentialsServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  registry: ConfigurationTypeRegistry;
  secretEncryptionKey: string | undefined;
  /** Wired in US2 — backs the delete-integrity guard (FR-012). */
  settings?: CredentialsSettingsPort;
}

export class CredentialsService {
  constructor(private readonly deps: CredentialsServiceDeps) {}

  /** Registered configuration types powering the admin type picker + form. */
  describeTypes(): ConfigurationTypeDescriptor[] {
    return this.deps.registry.describe();
  }

  async list(typeFilter?: string): Promise<ConfigurationDto[]> {
    const em = this.deps.emFactory();
    const where = typeFilter ? { typeCode: typeFilter } : {};
    const rows = await em.find(CredentialConfiguration, where, { orderBy: { name: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async getByCode(code: string): Promise<ConfigurationDto | null> {
    const em = this.deps.emFactory();
    const row = await em.findOne(CredentialConfiguration, { code });
    return row ? this.toDto(row) : null;
  }

  async create(data: CreateConfiguration): Promise<ConfigurationDto> {
    const entity = await this.deps.commandBus.run(
      makeCreateConfigurationCommand({
        data,
        registry: this.deps.registry,
        secretEncryptionKey: this.deps.secretEncryptionKey,
      }),
    );
    return this.toDto(entity);
  }

  async update(code: string, data: UpdateConfiguration): Promise<ConfigurationDto> {
    const entity = await this.deps.commandBus.run(
      makeUpdateConfigurationCommand({
        code,
        data,
        registry: this.deps.registry,
        secretEncryptionKey: this.deps.secretEncryptionKey,
      }),
    );
    return this.toDto(entity);
  }

  async delete(code: string): Promise<void> {
    // Delete-integrity guard (FR-012): block if any setting references this
    // configuration, listing the referrers. Read-then-delete — a race is
    // acceptable for this admin-only, low-volume operation.
    if (this.deps.settings) {
      const referencedBy = await this.deps.settings.listReferencesToConfiguration(code);
      if (referencedBy.length > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.CREDENTIAL_IN_USE,
          'Configuration is referenced by one or more settings.',
          { referencedBy },
        );
      }
    }
    await this.deps.commandBus.run(
      makeDeleteConfigurationCommand({ code, registry: this.deps.registry }),
    );
  }

  /**
   * Server-side resolution (feature 058 US2) — the single path that returns
   * DECRYPTED secret values, for a consumer's in-memory use only. Never exposed
   * over HTTP. Fails closed: an unset reference is `not_configured`; a
   * deleted/inert one is `unavailable` — never a foreign configuration
   * (FR-012 / SC-005).
   */
  async resolve(configurationCode: string): Promise<ResolveResult> {
    if (!configurationCode || configurationCode.length === 0) {
      return { status: 'not_configured' };
    }
    const em = this.deps.emFactory();
    const entity = await em.findOne(CredentialConfiguration, { code: configurationCode });
    if (!entity) return { status: 'unavailable', reason: 'missing' };

    const descriptor = this.deps.registry.get(entity.typeCode);
    const variant = descriptor?.providers.find((p) => p.code === entity.providerCode);
    if (!descriptor || !variant) return { status: 'unavailable', reason: 'inert_type' };

    const values: Record<string, unknown> = {};
    for (const field of variant.fields) {
      const stored = entity.values[field.key];
      if (stored === undefined) continue;
      if (field.secret) {
        values[field.key] = secretValueIsSet(stored)
          ? decryptSecretValue(stored, this.deps.secretEncryptionKey)
          : stored;
      } else {
        values[field.key] = stored;
      }
    }
    return {
      status: 'ok',
      typeCode: entity.typeCode,
      providerCode: entity.providerCode,
      values,
    };
  }

  /**
   * Map an entity to a masked DTO, marking unregistered-type rows as inert.
   *
   * The registry's **diagnostic** read (issue #129): a stored configuration
   * whose contributing module is merely switched off keeps its label and its
   * field shape, because deactivation drops no data and an inert row would say
   * the type is gone. `resolve` above stays on the acting read, so nothing
   * decrypted leaves for the same configuration.
   */
  private toDto(entity: CredentialConfiguration): ConfigurationDto {
    const descriptor = this.deps.registry.entry(entity.typeCode);
    const variant = descriptor?.providers.find((p) => p.code === entity.providerCode);
    const inert = !descriptor || !variant;
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      typeCode: entity.typeCode,
      typeLabel: descriptor?.label ?? null,
      providerCode: entity.providerCode,
      providerLabel: variant?.label ?? null,
      inert,
      // An inert row has no known field shape — expose no fields rather than
      // risk leaking a value we cannot classify as secret.
      fields: variant ? maskSecrets(entity.values, variant.fields) : [],
      version: entity.version,
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
