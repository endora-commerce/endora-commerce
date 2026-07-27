import { ERROR_CODES } from '@b2b/contracts';
import type { AuditState, Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { CredentialConfiguration } from '../entities/credential-configuration.entity.js';
import type { ConfigurationTypeRegistry } from '../services/configuration-type-registry.js';
import { redactSecretsForAudit } from '../services/field-validator.js';

/**
 * `credential.delete` (feature 058 US1, Principle XIII).
 *
 * Unconditional delete for US1 — the referencing-setting guard (`CREDENTIAL_IN_USE`)
 * is added in US2 (T043). Captures the before-state with secrets redacted.
 * Irreversible.
 */
export function makeDeleteConfigurationCommand(input: {
  code: string;
  registry: ConfigurationTypeRegistry;
}): Command<{ code: string }> {
  const { code, registry } = input;

  const variantFields = (entity: CredentialConfiguration) => {
    const descriptor = registry.get(entity.typeCode);
    return descriptor?.providers.find((p) => p.code === entity.providerCode)?.fields ?? [];
  };

  return {
    action: 'credential.delete',
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
        values: redactSecretsForAudit(entity.values, variantFields(entity)),
      };
    },
    run: async ({ em }) => {
      const entity = await em.findOne(CredentialConfiguration, { code });
      if (!entity) {
        throw new HttpError(404, ERROR_CODES.CREDENTIAL_NOT_FOUND, `Configuration "${code}" not found.`);
      }
      await em.removeAndFlush(entity);
      return { result: { code }, after: null };
    },
  };
}
