import { z } from 'zod';
import type {
  ConfigurationFieldDto,
  ConfigurationTypeDescriptor,
  FieldDefinition,
  ProviderVariant,
} from '@b2b/contracts';
import { ConfigurationTypeUnknown } from './configuration-type-registry.js';
import { encryptSecretValue, secretValueIsSet } from './secret-value-codec.js';

/** Sentinel a masked secret is echoed back as; submitting it preserves the stored envelope. */
export const SECRET_MASK = '[redacted]';

export interface FieldError {
  field: string;
  message: string;
}

export interface BuildValuesResult {
  values: Record<string, unknown>;
  errors: FieldError[];
}

/**
 * Field validation + secret masking derived from a configuration-type
 * descriptor (feature 058, research §R2). The credentials core stays
 * type-agnostic (Principle XIV): the write-validator is built purely from the
 * selected provider's `FieldDefinition[]` — the same technique custom-fields
 * uses to derive a validator from a stored definition.
 */

/** Resolve a provider variant within a type descriptor, or throw. */
export function providerVariantFor(
  descriptor: ConfigurationTypeDescriptor,
  providerCode: string,
): ProviderVariant {
  const variant = descriptor.providers.find((p) => p.code === providerCode);
  if (!variant) {
    throw new ConfigurationTypeUnknown(`${descriptor.code}/${providerCode}`);
  }
  return variant;
}

function baseSchemaForField(field: FieldDefinition): z.ZodTypeAny {
  switch (field.kind) {
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'select': {
      const allowed = (field.options ?? []).map((o) => o.value);
      return z
        .string()
        .refine((v) => allowed.includes(v), { message: `must be one of: ${allowed.join(', ')}` });
    }
    case 'string':
    default:
      return z.string();
  }
}

/**
 * Build a Zod object schema validating a values bag against the provider
 * variant's field definitions. Required fields must be present; required
 * string/select fields must be non-empty. Unknown keys are stripped.
 *
 * Note: write-only secret semantics (a blank/`[redacted]` secret on update
 * preserving the stored envelope) are applied by the update command BEFORE
 * validation, not here — this validator sees the effective values to persist.
 */
export function buildFieldValidator(
  descriptor: ConfigurationTypeDescriptor,
  providerCode: string,
): z.ZodType<Record<string, unknown>> {
  const variant = providerVariantFor(descriptor, providerCode);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of variant.fields) {
    let schema = baseSchemaForField(field);
    if (field.required) {
      if (field.kind === 'string' || field.kind === 'select') {
        schema = (schema as z.ZodString).min(1, { message: 'is required' });
      }
    } else {
      schema = schema.optional();
    }
    shape[field.key] = schema;
  }
  return z.object(shape).strip() as z.ZodType<Record<string, unknown>>;
}

/**
 * Compute the effective values bag to persist, validating each field against the
 * provider descriptor and applying write-only secret semantics (FR-015):
 *
 *  - a secret field submitted blank / omitted / equal to the `[redacted]` mask
 *    keeps the existing envelope; a non-empty secret is re-encrypted;
 *  - a non-secret field absent from `submitted` keeps its existing value (so a
 *    partial update need not resend every field);
 *  - required fields must be present and non-empty (per-field error otherwise).
 *
 * `existing` is `{}` on create. Errors are collected per field (never throws for
 * a validation problem) so the caller can surface a `CREDENTIAL_VALIDATION_FAILED`
 * envelope carrying every offending field at once.
 */
export function buildPersistableValues(opts: {
  fields: FieldDefinition[];
  submitted: Record<string, unknown>;
  existing: Record<string, unknown>;
  secretEncryptionKey: string | undefined;
}): BuildValuesResult {
  const { fields, submitted, existing, secretEncryptionKey } = opts;
  const values: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  for (const field of fields) {
    if (field.secret) {
      const raw = submitted[field.key];
      const providesNew = typeof raw === 'string' && raw.length > 0 && raw !== SECRET_MASK;
      if (providesNew) {
        values[field.key] = encryptSecretValue(raw, secretEncryptionKey);
      } else if (secretValueIsSet(existing[field.key])) {
        values[field.key] = existing[field.key];
      }
      if (field.required && !(field.key in values)) {
        errors.push({ field: field.key, message: 'is required' });
      }
      continue;
    }

    const hasSubmitted = Object.prototype.hasOwnProperty.call(submitted, field.key);
    const candidate = hasSubmitted ? submitted[field.key] : existing[field.key];

    if (candidate === undefined || candidate === null) {
      if (field.required) errors.push({ field: field.key, message: 'is required' });
      continue;
    }

    const typeError = validateNonSecretValue(field, candidate);
    if (typeError) {
      errors.push({ field: field.key, message: typeError });
      continue;
    }
    values[field.key] = candidate;
  }

  return { values, errors };
}

function validateNonSecretValue(field: FieldDefinition, value: unknown): string | null {
  switch (field.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'select': {
      if (typeof value !== 'string') return 'must be a string';
      const allowed = (field.options ?? []).map((o) => o.value);
      return allowed.includes(value) ? null : `must be one of: ${allowed.join(', ')}`;
    }
    case 'string':
    default:
      if (typeof value !== 'string') return 'must be a string';
      if (field.required && value.length === 0) return 'is required';
      return null;
  }
}

/**
 * Redact secret field values for an audit snapshot: a set secret becomes the
 * `[redacted]` mask, non-secret values pass through (FR-014). Never emits a
 * plaintext or an envelope.
 */
export function redactSecretsForAudit(
  values: Record<string, unknown>,
  fields: FieldDefinition[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.secret) {
      out[field.key] = secretValueIsSet(values[field.key]) ? SECRET_MASK : null;
    } else if (Object.prototype.hasOwnProperty.call(values, field.key)) {
      out[field.key] = values[field.key];
    }
  }
  return out;
}

/**
 * Mask a stored values bag for a read DTO: secret fields expose only an `isSet`
 * boolean (never a value); non-secret fields expose their plain value. Returned
 * in descriptor field order. A `maskSecrets` guarantee: a secret value is never
 * emitted (SC-003 / FR-005).
 */
export function maskSecrets(
  values: Record<string, unknown>,
  fields: FieldDefinition[],
): ConfigurationFieldDto[] {
  return fields.map((field) => {
    if (field.secret) {
      return { key: field.key, secret: true, isSet: secretValueIsSet(values[field.key]) };
    }
    return { key: field.key, secret: false, value: values[field.key] };
  });
}
