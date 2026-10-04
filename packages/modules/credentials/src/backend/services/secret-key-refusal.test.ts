import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus, CommandContext } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { makeCreateConfigurationCommand } from '../commands/create-configuration.command.js';
import { makeUpdateConfigurationCommand } from '../commands/update-configuration.command.js';
import type { CredentialConfiguration } from '../entities/credential-configuration.entity.js';
import { llmConfigurationType } from '../types/llm.type.js';
import { ConfigurationTypeRegistry } from './configuration-type-registry.js';
import { CredentialsService } from './credentials.service.js';
import { encryptSecretValue } from './secret-value-codec.js';

/**
 * A missing or malformed `SETTINGS_SECRET_ENCRYPTION_KEY` is an operator's
 * configuration fault, and the three places this module runs the secret codec
 * must say so: a typed `SETTING_SECRET_KEY_MISSING` refusal naming the variable,
 * never a plain `Error` the envelope can only answer as `500 INTERNAL`.
 *
 * It still fails closed — nothing is written and nothing is decrypted. What
 * changes is that the answer names the thing to fix.
 */
const VALID_KEY = randomBytes(32).toString('base64');
const SHORT_KEY = randomBytes(16).toString('base64');

function registry(): ConfigurationTypeRegistry {
  const r = new ConfigurationTypeRegistry();
  r.register(llmConfigurationType);
  return r;
}

function storedRow(values: Record<string, unknown>): CredentialConfiguration {
  return {
    id: 'row-1',
    code: 'llm-main',
    name: 'Main LLM',
    typeCode: 'llm',
    providerCode: 'anthropic',
    values,
    version: 1,
  } as unknown as CredentialConfiguration;
}

function contextWith(row: CredentialConfiguration | null): CommandContext {
  const em = {
    findOne: async () => row,
    create: (_cls: unknown, data: unknown) => data,
    persistAndFlush: async () => undefined,
    flush: async () => undefined,
  } as unknown as EntityManager;
  return { em } as unknown as CommandContext;
}

async function refusalOf(run: () => unknown): Promise<HttpError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw new Error(
      `expected an HttpError, got ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
  }
  throw new Error('expected a refusal, and the call succeeded');
}

describe('credentials — a secret key fault is a typed refusal [unit]', () => {
  const create = (secretEncryptionKey: string | undefined) =>
    makeCreateConfigurationCommand({
      data: {
        code: 'llm-main',
        name: 'Main LLM',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'sk-live', model: 'claude-opus-4-8' },
      },
      registry: registry(),
      secretEncryptionKey,
    });

  it('create: no key → 500 SETTING_SECRET_KEY_MISSING naming the variable', async () => {
    const refusal = await refusalOf(() => create(undefined).run(contextWith(null)));
    expect(refusal.statusCode).toBe(500);
    expect(refusal.code).toBe('SETTING_SECRET_KEY_MISSING');
    expect(refusal.message).toContain('SETTINGS_SECRET_ENCRYPTION_KEY');
  });

  it('create: a key of the wrong length → the same code, saying what is wrong with it', async () => {
    const refusal = await refusalOf(() => create(SHORT_KEY).run(contextWith(null)));
    expect(refusal.statusCode).toBe(500);
    expect(refusal.code).toBe('SETTING_SECRET_KEY_MISSING');
    expect(refusal.message).toContain('32 bytes');
  });

  it('update: re-encrypting a secret with no key → 500 SETTING_SECRET_KEY_MISSING', async () => {
    const command = makeUpdateConfigurationCommand({
      code: 'llm-main',
      data: { values: { apiKey: 'sk-rotated' } },
      registry: registry(),
      secretEncryptionKey: undefined,
    });
    const row = storedRow({ apiKey: encryptSecretValue('sk-live', VALID_KEY), model: 'm' });
    const refusal = await refusalOf(() => command.run(contextWith(row)));
    expect(refusal.statusCode).toBe(500);
    expect(refusal.code).toBe('SETTING_SECRET_KEY_MISSING');
  });

  it('resolve: decrypting a stored envelope with no key → 500 SETTING_SECRET_KEY_MISSING', async () => {
    const row = storedRow({ apiKey: encryptSecretValue('sk-live', VALID_KEY), model: 'm' });
    const service = new CredentialsService({
      emFactory: () => ({ findOne: async () => row }) as unknown as EntityManager,
      commandBus: {} as CommandBus,
      registry: registry(),
      secretEncryptionKey: undefined,
    });
    const refusal = await refusalOf(() => service.resolve('llm-main'));
    expect(refusal.statusCode).toBe(500);
    expect(refusal.code).toBe('SETTING_SECRET_KEY_MISSING');
  });

  it('leaves a failure that is not a key fault alone', async () => {
    // A tampered envelope under a perfectly good key is not the operator's
    // missing variable, and must not be reported as one.
    const envelope = encryptSecretValue('sk-live', VALID_KEY);
    const tampered = { ...envelope, tag: Buffer.alloc(16).toString('base64') };
    const service = new CredentialsService({
      emFactory: () =>
        ({ findOne: async () => storedRow({ apiKey: tampered }) }) as unknown as EntityManager,
      commandBus: {} as CommandBus,
      registry: registry(),
      secretEncryptionKey: VALID_KEY,
    });
    await expect(service.resolve('llm-main')).rejects.not.toBeInstanceOf(HttpError);
  });
});
