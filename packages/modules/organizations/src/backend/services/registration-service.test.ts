/**
 * `RegistrationService` after `specs/176-command-hooks-outbox/` (T006; FR-007,
 * FR-009): a thin orchestration around the `organization.register` Command.
 *
 * Everything that does not write and may be slow or remote runs **before** the
 * Command, so no dependency holds its transaction open: the country dictionary,
 * the fast tax-ID and e-mail pre-checks, the registry ticket read, the
 * custom-field validation — and the password hash. The ticket is deleted only
 * after the Command committed, best effort. The service records no audit entry
 * of its own: the bus writes the Command's.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomerAccountMemberCommandPort,
  type CustomerAccountRecord,
  type RegisterOrganizationRequest,
} from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RegistryLookupSnapshot } from '../registry-lookup/company-registry-port.js';
import { RegistrationService, type OrganizationEventBus } from './registration-service.js';

function request(registryLookupId?: string): RegisterOrganizationRequest {
  return {
    organization: {
      name: 'Acme',
      // A valid NIP: the ticket check only matches a tax ID the lookup could have issued.
      taxId: 'PL1111111111',
      registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
      customFieldValues: { tier: 'gold' },
    },
    firstUser: {
      email: 'ada@example.com',
      password: 'correct horse battery staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    acceptedTermsVersion: '1',
    ...(registryLookupId ? { registryLookupId } : {}),
  } as RegisterOrganizationRequest;
}

function harness(options: { runFails?: Error; emailTaken?: boolean } = {}) {
  const steps: string[] = [];
  const em = { execute: async () => [] } as unknown as EntityManager;
  const commandBus = {
    run: async (command: Command<unknown>) => {
      steps.push(`run:${command.action}`);
      if (options.runFails) throw options.runFails;
      return { organization: { id: 'org' }, customerAccount: { id: 'acc' }, verificationToken: 'raw' };
    },
  } as unknown as Pick<CommandBus, 'run'>;
  const commands: CustomerAccountMemberCommandPort = {
    prepareCreate: async () => {
      steps.push('hash');
      return { command: () => ({}) as Command<CustomerAccountRecord> };
    },
  };
  const service = new RegistrationService({
    emFactory: () => {
      steps.push('taxId pre-check');
      return em;
    },
    commandBus,
    events: { emit: () => undefined } as unknown as OrganizationEventBus,
    accounts: {
      read: {
        findByEmail: async () => {
          steps.push('email pre-check');
          return options.emailTaken ? { id: 'someone' } : null;
        },
      } as never,
      commands,
    },
    dictionaryValidator: {
      validateCountryCode: async () => {
        steps.push('country');
      },
    } as never,
    registryLookup: {
      isEnabled: async () => true,
      readTicket: async () => {
        steps.push('ticket read');
        return {
          version: 1,
          lookupId: 'L',
          fromCache: false,
          issuedAt: new Date().toISOString(),
          status: 'not_found',
          country: 'PL',
          taxId: '1111111111',
          plSources: 'gus_mf',
          record: null,
          dataSource: null,
          vatStatusSource: null,
          attempts: [],
          fetchedAt: new Date().toISOString(),
        } as unknown as RegistryLookupSnapshot;
      },
      deleteTicket: async () => {
        steps.push('ticket delete');
      },
    },
    customFieldValues: {
      validateForCustomerInput: async (_entityType, values) => {
        steps.push('custom fields');
        return { ...(values ?? {}) };
      },
    },
  });
  return { service, steps };
}

describe('RegistrationService — validations first, one Command, cleanup after (176 T006)', () => {
  it('runs every non-writing validation and the hash before the Command', async () => {
    const h = harness();

    await h.service.registerOrganization(request());

    expect(h.steps).toEqual([
      'country',
      'taxId pre-check',
      'email pre-check',
      'custom fields',
      'custom fields',
      'hash',
      'run:organization.register',
    ]);
  });

  it('refuses before hashing when the fast pre-check sees the e-mail taken', async () => {
    const h = harness({ emailTaken: true });

    await expect(h.service.registerOrganization(request())).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.EMAIL_ALREADY_REGISTERED,
    });
    expect(h.steps).not.toContain('hash');
    expect(h.steps).not.toContain('run:organization.register');
  });

  it('reads the registry ticket before the Command and deletes it only after it committed', async () => {
    const ok = harness();
    const lookupId = 'Z'.repeat(43);
    await ok.service.registerOrganization(request(lookupId));
    expect(ok.steps.indexOf('ticket read')).toBeLessThan(ok.steps.indexOf('run:organization.register'));
    expect(ok.steps.at(-1)).toBe('ticket delete');

    const refused = harness({ runFails: new HttpError(409, ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'taken') });
    await expect(refused.service.registerOrganization(request(lookupId))).rejects.toMatchObject({ statusCode: 409 });
    expect(refused.steps).toContain('ticket read');
    expect(refused.steps).not.toContain('ticket delete');
  });

  it('records no audit entry by hand', () => {
    const source = readFileSync(fileURLToPath(new URL('./registration-service.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/recordAuditFromContext|recordWithin|auditLog/);
  });
});
