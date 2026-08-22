import { ERROR_CODES, type CreateConfiguration } from '@endora-commerce/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { CredentialConfiguration } from '../entities/credential-configuration.entity.js';
import type { ConfigurationTypeRegistry } from '../services/configuration-type-registry.js';
import { ConfigurationTypeUnknown } from '../services/configuration-type-registry.js';
import {
  buildPersistableValues,
  providerVariantFor,
  redactSecretsForAudit,
} from '../services/field-validator.js';

/**
 * `credential.create` (feature 058 US1, Principle XIII).
 *
 * Validates the submitted values against the selected type/provider descriptor,
 * encrypts secret fields, and persists a new configuration. Secrets are redacted
 * in the audit `after` state. Irreversible (undoing a secret change is
 * high-risk).
 */
export function makeCreateConfigurationCommand(input: {
  data: CreateConfiguration;
  registry: ConfigurationTypeRegistry;
  secretEncryptionKey: string | undefined;
}): Command<CredentialConfiguration> {
  const { data, registry, secretEncryptionKey } = input;
  return {
    action: 'credential.create',
    objectType: 'credential_configuration',
    objectId: data.code,
    run: async ({ em }) => {
      let descriptor;
      try {
        descriptor = registry.resolve(data.typeCode);
      } catch (err) {
        if (err instanceof ConfigurationTypeUnknown) {
          throw new HttpError(400, ERROR_CODES.CREDENTIAL_TYPE_UNKNOWN, `Unknown configuration type "${data.typeCode}".`);
        }
        throw err;
      }
      const variant = descriptor.providers.find((p) => p.code === data.providerCode);
      if (!variant) {
        throw new HttpError(
          400,
          ERROR_CODES.CREDENTIAL_TYPE_UNKNOWN,
          `Unknown provider "${data.providerCode}" for type "${data.typeCode}".`,
        );
      }

      const existing = await em.findOne(CredentialConfiguration, { code: data.code });
      if (existing) {
        throw new HttpError(409, ERROR_CODES.CREDENTIAL_CODE_TAKEN, `Code "${data.code}" is already in use.`);
      }

      const { values, errors } = buildPersistableValues({
        fields: variant.fields,
        submitted: data.values,
        existing: {},
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

      const entity = em.create(CredentialConfiguration, {
        code: data.code,
        name: data.name,
        typeCode: data.typeCode,
        providerCode: data.providerCode,
        values,
      });
      await em.persistAndFlush(entity);

      return {
        result: entity,
        after: {
          code: entity.code,
          name: entity.name,
          typeCode: entity.typeCode,
          providerCode: entity.providerCode,
          values: redactSecretsForAudit(values, variant.fields),
        },
      };
    },
  };
}

export { providerVariantFor };
