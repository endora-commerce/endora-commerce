import { ERROR_CODES, type UpdateConfiguration } from '@endora-commerce/contracts';
import type { AuditState, Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { ModuleDisabledError } from '../../../kernel/lifecycle/plugin-helpers.js';
import { CredentialConfiguration } from '../entities/credential-configuration.entity.js';
import type { ConfigurationTypeRegistry } from '../services/configuration-type-registry.js';
import {
  buildPersistableValues,
  redactSecretsForAudit,
} from '../services/field-validator.js';

/**
 * `credential.update` (feature 058 US1, Principle XIII).
 *
 * Write-only secret preservation: a secret submitted blank / omitted / equal to
 * the `[redacted]` mask keeps the stored envelope; a non-empty secret is
 * re-encrypted. `typeCode`/`providerCode` are immutable (rejected upstream in
 * the route). Honors `expectedVersion` (optimistic lock). Secrets redacted in
 * both audit states. Irreversible.
 */
export function makeUpdateConfigurationCommand(input: {
  code: string;
  data: UpdateConfiguration;
  registry: ConfigurationTypeRegistry;
  secretEncryptionKey: string | undefined;
}): Command<CredentialConfiguration> {
  const { code, data, registry, secretEncryptionKey } = input;

  // The registry's diagnostic read (issue #129), for the same reason as in the
  // delete command: an audit snapshot must know which value was a secret
  // whatever the contributing module's state. The write itself reads the acting
  // side and refuses — see `run`.
  const loadVariantFields = (entity: CredentialConfiguration) => {
    const descriptor = registry.entry(entity.typeCode);
    const variant = descriptor?.providers.find((p) => p.code === entity.providerCode);
    return variant?.fields ?? [];
  };

  return {
    action: 'credential.update',
    objectType: 'credential_configuration',
    objectId: code,
    capture: async ({ em }): Promise<AuditState> => {
      const entity = await em.findOne(CredentialConfiguration, { code });
      if (!entity) return null;
      return {
        code: entity.code,
        name: entity.name,
        typeCode: entity.typeCode,
        providerCode: entity.providerCode,
        values: redactSecretsForAudit(entity.values, loadVariantFields(entity)),
      };
    },
    run: async ({ em }) => {
      const entity = await em.findOne(CredentialConfiguration, { code });
      if (!entity) {
        throw new HttpError(404, ERROR_CODES.CREDENTIAL_NOT_FOUND, `Configuration "${code}" not found.`);
      }

      if (data.expectedVersion !== undefined && entity.version !== data.expectedVersion) {
        throw new HttpError(
          409,
          ERROR_CODES.VERSION_CONFLICT,
          'The configuration was modified by someone else. Reload and try again.',
        );
      }

      // The acting read, and the two "no descriptor" answers kept apart: a type
      // nobody registers is the inert row FR-016 describes, while a type whose
      // contributing module is switched off comes straight back with that module
      // — so it refuses with the 503 envelope naming it, rather than telling an
      // operator their configuration has lost its type.
      const owner = registry.ownerOf(entity.typeCode);
      if (owner !== null && !registry.isAvailable(entity.typeCode)) {
        throw new ModuleDisabledError(owner);
      }

      const descriptor = registry.get(entity.typeCode);
      const variant = descriptor?.providers.find((p) => p.code === entity.providerCode);
      if (!variant) {
        // Inert: the type/provider is no longer registered — refuse to edit
        // rather than validate against an unknown shape (FR-016).
        throw new HttpError(
          400,
          ERROR_CODES.CREDENTIAL_TYPE_UNKNOWN,
          `Configuration type "${entity.typeCode}" is no longer registered.`,
        );
      }

      if (data.name !== undefined) entity.name = data.name;

      if (data.values !== undefined) {
        const { values, errors } = buildPersistableValues({
          fields: variant.fields,
          submitted: data.values,
          existing: entity.values,
          secretEncryptionKey,
        });
        if (errors.length > 0) {
          throw new HttpError(
            422,
            ERROR_CODES.CREDENTIAL_VALIDATION_FAILED,
            'Some fields are invalid.',
            errors.map((e) => ({ path: e.field, issue: e.message })),
          );
        }
        entity.values = values;
      }

      await em.flush();

      return {
        result: entity,
        after: {
          code: entity.code,
          name: entity.name,
          typeCode: entity.typeCode,
          providerCode: entity.providerCode,
          values: redactSecretsForAudit(entity.values, variant.fields),
        },
      };
    },
  };
}
