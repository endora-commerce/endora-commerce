import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '@b2b/contracts';
import {
  buildPersistableValues,
  maskSecrets,
} from '../../../src/modules/credentials/services/field-validator.js';
import { llmConfigurationType } from '../../../src/modules/credentials/types/llm.type.js';
import { emailAdapterConfigurationType } from '../../../src/modules/credentials/types/email-adapter.type.js';
import {
  decryptSecretValue,
  isSecretEnvelope,
} from '../../../src/modules/credentials/services/secret-value-codec.js';

/**
 * Feature 058 US1 (T017) — field validation + secret masking derived purely
 * from a type descriptor (no DB). Asserts required/kind/select enforcement,
 * write-only secret preservation, and that masking never emits a secret value.
 */
const KEY = randomBytes(32).toString('base64');
const anthropic = llmConfigurationType.providers.find((p) => p.code === 'anthropic')!;
const smtp = emailAdapterConfigurationType.providers.find((p) => p.code === 'smtp')!;

describe('buildPersistableValues [unit]', () => {
  it('encrypts a required secret and keeps plain fields', () => {
    const { values, errors } = buildPersistableValues({
      fields: anthropic.fields,
      submitted: { apiKey: 'sk-live', model: 'claude-opus-4-8' },
      existing: {},
      secretEncryptionKey: KEY,
    });
    expect(errors).toEqual([]);
    expect(isSecretEnvelope(values['apiKey'])).toBe(true);
    expect(decryptSecretValue(values['apiKey'], KEY)).toBe('sk-live');
    expect(values['model']).toBe('claude-opus-4-8');
  });

  it('flags a missing required field (secret and non-secret)', () => {
    const { errors } = buildPersistableValues({
      fields: anthropic.fields,
      submitted: {},
      existing: {},
      secretEncryptionKey: KEY,
    });
    const keys = errors.map((e) => e.field).sort();
    expect(keys).toEqual(['apiKey', 'model']);
  });

  it('preserves an existing secret when the field is blank / [redacted] on update', () => {
    const existing = buildPersistableValues({
      fields: anthropic.fields,
      submitted: { apiKey: 'sk-first', model: 'm1' },
      existing: {},
      secretEncryptionKey: KEY,
    }).values;

    const updated = buildPersistableValues({
      fields: anthropic.fields,
      submitted: { apiKey: '[redacted]', model: 'm2' },
      existing,
      secretEncryptionKey: KEY,
    });
    expect(updated.errors).toEqual([]);
    // The secret envelope is carried over verbatim (not re-encrypted / cleared).
    expect(updated.values['apiKey']).toBe(existing['apiKey']);
    expect(updated.values['model']).toBe('m2');
  });

  it('re-encrypts a secret when a new non-empty value is submitted', () => {
    const existing = { apiKey: 'legacy', model: 'm1' };
    const updated = buildPersistableValues({
      fields: anthropic.fields,
      submitted: { apiKey: 'sk-new' },
      existing,
      secretEncryptionKey: KEY,
    });
    expect(isSecretEnvelope(updated.values['apiKey'])).toBe(true);
    expect(decryptSecretValue(updated.values['apiKey'], KEY)).toBe('sk-new');
    // Absent non-secret keeps existing.
    expect(updated.values['model']).toBe('m1');
  });

  it('validates kinds: number and boolean', () => {
    const bad = buildPersistableValues({
      fields: smtp.fields,
      submitted: { host: 'mail', port: 'not-a-number', secure: 'yes' },
      existing: {},
      secretEncryptionKey: KEY,
    });
    const badKeys = bad.errors.map((e) => e.field).sort();
    expect(badKeys).toContain('port');
    expect(badKeys).toContain('secure');

    const good = buildPersistableValues({
      fields: smtp.fields,
      submitted: { host: 'mail', port: 587, secure: true },
      existing: {},
      secretEncryptionKey: KEY,
    });
    expect(good.errors).toEqual([]);
    expect(good.values['port']).toBe(587);
    expect(good.values['secure']).toBe(true);
  });

  it('enforces select options', () => {
    const fields: FieldDefinition[] = [
      {
        key: 'tier',
        label: 'Tier',
        kind: 'select',
        required: true,
        secret: false,
        options: [
          { value: 'gold', label: 'Gold' },
          { value: 'silver', label: 'Silver' },
        ],
      },
    ];
    expect(
      buildPersistableValues({ fields, submitted: { tier: 'platinum' }, existing: {}, secretEncryptionKey: KEY }).errors,
    ).toHaveLength(1);
    expect(
      buildPersistableValues({ fields, submitted: { tier: 'gold' }, existing: {}, secretEncryptionKey: KEY }).errors,
    ).toEqual([]);
  });
});

describe('maskSecrets [unit]', () => {
  it('never emits a secret value; exposes isSet instead', () => {
    const { values } = buildPersistableValues({
      fields: anthropic.fields,
      submitted: { apiKey: 'sk-live', model: 'claude-opus-4-8' },
      existing: {},
      secretEncryptionKey: KEY,
    });
    const masked = maskSecrets(values, anthropic.fields);
    const apiKeyDto = masked.find((f) => f.key === 'apiKey')!;
    expect(apiKeyDto.secret).toBe(true);
    expect(apiKeyDto.isSet).toBe(true);
    expect('value' in apiKeyDto).toBe(false);
    // No serialization of the masked DTO leaks the plaintext or envelope.
    expect(JSON.stringify(masked)).not.toContain('sk-live');

    const modelDto = masked.find((f) => f.key === 'model')!;
    expect(modelDto.secret).toBe(false);
    expect(modelDto.value).toBe('claude-opus-4-8');
  });
});
