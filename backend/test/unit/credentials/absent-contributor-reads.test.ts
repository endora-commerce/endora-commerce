import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ConfigurationTypeDescriptor } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandActor, CommandBus } from '../../../src/commands/index.js';
import { makeDeleteConfigurationCommand } from '../../../src/modules/credentials/commands/delete-configuration.command.js';
import { makeUpdateConfigurationCommand } from '../../../src/modules/credentials/commands/update-configuration.command.js';
import { ConfigurationTypeRegistry } from '../../../src/modules/credentials/services/configuration-type-registry.js';
import { CredentialsService } from '../../../src/modules/credentials/services/credentials.service.js';
import { encryptSecretValue } from '../../../src/modules/credentials/services/secret-value-codec.js';
import { SECRET_MASK } from '../../../src/modules/credentials/services/field-validator.js';

/**
 * Issue #129 — which side of the `configurationTypeRegistry` split each caller
 * in `credentials` reads.
 *
 * The registry states a skip policy, so the question that decides whether the
 * policy helps or harms is per call site. Offering an absent module's type in
 * the picker, or validating a write against it, is the surface Principle XVII
 * closes. Rendering a configuration an operator already stored, and redacting
 * that configuration into an audit snapshot, are not surfaces at all: switching
 * a module off drops no data, so a row that keeps its secret must keep the field
 * shape that says which of its values is a secret.
 */

const KEY = randomBytes(32).toString('base64');
const ABSENT = 'pim_ergonode';

const descriptor: ConfigurationTypeDescriptor = {
  code: 'ergonode',
  label: 'Ergonode connection',
  ownerModule: ABSENT,
  providers: [
    {
      code: 'default',
      label: 'Default',
      fields: [
        { key: 'token', label: 'Token', kind: 'string', required: true, secret: true },
        { key: 'endpoint', label: 'Endpoint', kind: 'string', required: false, secret: false },
      ],
    },
  ],
};

const presentType: ConfigurationTypeDescriptor = {
  code: 'llm',
  label: 'LLM',
  ownerModule: 'credentials',
  providers: [{ code: 'anthropic', label: 'Anthropic', fields: [] }],
};

/** Everything present except the module that contributed the Ergonode type. */
const presenceOf = (moduleId: string): boolean | undefined =>
  moduleId === ABSENT ? false : moduleId === 'credentials' ? true : undefined;

function storedRow(): Record<string, unknown> {
  return {
    id: 'cfg-1',
    code: 'ergonode-main',
    name: 'Ergonode main',
    typeCode: 'ergonode',
    providerCode: 'default',
    values: {
      token: encryptSecretValue('sk-ergonode', KEY),
      endpoint: 'https://pim.example.test',
    },
    version: 3,
    updatedAt: new Date('2026-08-17T00:00:00.000Z'),
  };
}

/** Just enough EntityManager for the two read paths under test. */
function emWith(row: Record<string, unknown> | null): EntityManager {
  return {
    findOne: async () => row,
    find: async () => (row ? [row] : []),
  } as unknown as EntityManager;
}

function serviceFor(row: Record<string, unknown> | null): {
  service: CredentialsService;
  registry: ConfigurationTypeRegistry;
} {
  const registry = new ConfigurationTypeRegistry(undefined, presenceOf);
  registry.register(descriptor);
  registry.register(presentType);
  const service = new CredentialsService({
    emFactory: () => emWith(row),
    commandBus: {} as unknown as CommandBus,
    registry,
    secretEncryptionKey: KEY,
  });
  return { service, registry };
}

describe('credentials reads while a contributing module is absent [unit]', () => {
  it('leaves the absent module’s type out of the picker', () => {
    const { service } = serviceFor(null);
    expect(service.describeTypes().map((type) => type.code)).toEqual(['llm']);
  });

  it('still renders a stored configuration of that type in full', async () => {
    // The diagnostic side. Marking the row `inert` here would tell an operator
    // their credential had lost its type — the state `unregister` produces — for
    // a module that is merely switched off and whose type comes straight back.
    const { service } = serviceFor(storedRow());
    const dto = await service.getByCode('ergonode-main');

    expect(dto?.inert).toBe(false);
    expect(dto?.typeLabel).toBe('Ergonode connection');
    expect(dto?.fields.map((field) => field.key)).toEqual(['token', 'endpoint']);
    expect(dto?.fields.find((field) => field.key === 'token')).toMatchObject({
      secret: true,
      isSet: true,
    });
  });

  it('hands no decrypted secret to a consumer', async () => {
    // The acting side, and the one that matters most: `resolve` is the single
    // path that returns plaintext. It already fails closed on an unknown type;
    // an absent contributor's type has to land in the same place.
    const { service } = serviceFor(storedRow());

    await expect(service.resolve('ergonode-main')).resolves.toEqual({
      status: 'unavailable',
      reason: 'inert_type',
    });
  });

  it('refuses an edit naming the module that is off', async () => {
    // The acting side of the same row the previous case renders. `get` answers
    // `undefined` for "nobody registered this type" and for "the module that did
    // is switched off" alike, and an operator has to be able to tell those apart:
    // the first is the inert row FR-016 describes, the second comes straight back
    // with the module.
    const { registry } = serviceFor(null);
    const command = makeUpdateConfigurationCommand({
      code: 'ergonode-main',
      data: { name: 'Renamed' },
      registry,
      secretEncryptionKey: KEY,
    });

    await expect(
      command.run({
        em: emWith(storedRow()),
        actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
      } as unknown as { em: EntityManager; actor: CommandActor }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'MODULE_DISABLED', moduleId: ABSENT });
  });

  it('redacts the deleted configuration’s secret into the audit snapshot', async () => {
    // A delete stays possible while the contributor is off, and the audit row it
    // writes must still know `token` is a secret. Reading the acting side here
    // would hand `redactSecretsForAudit` an empty field list, which records the
    // deletion of a credential without recording that it held one.
    const { registry } = serviceFor(null);
    const command = makeDeleteConfigurationCommand({ code: 'ergonode-main', registry });
    const before = await command.capture?.({
      em: emWith(storedRow()),
      actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
    } as unknown as { em: EntityManager; actor: CommandActor });

    expect(before).toMatchObject({
      code: 'ergonode-main',
      values: { token: SECRET_MASK, endpoint: 'https://pim.example.test' },
    });
  });
});
