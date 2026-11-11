/**
 * `organization.register` — audit state (`specs/176-command-hooks-outbox/` T005,
 * FR-007; `specs/conventions/audit-state.md` §6, D-288, owner ruling O-2).
 *
 * The registration's one `organization.register` entry is written by the bus,
 * and it names the whole registration — the fields the Organization was
 * created with and the custom-field keys of **both** groups, the Organization's
 * and its first user's — without one value: not the name, tax ID or address,
 * not the first user's e-mail or names, not a custom-field value, and not the
 * tenant anchor (the new Organization's id may be the entry's object, never
 * part of its state). Every top-level key is in `ORGANIZATION_AUDIT_KEYS`.
 *
 * Moved here from `organization-audit-sentinels.test.ts`, which held the case
 * while registration recorded its entry by hand.
 */
import { AssertionError } from 'node:assert';
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type {
  CustomerAccountCreatePreparation,
  CustomerAccountMemberCommandPort,
  CustomerAccountRecord,
  RegisterOrganizationRequest,
} from '@endora-commerce/contracts';
import { CommandBus, type Command } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import { ORGANIZATION_AUDIT_KEYS } from '../services/organization-audit-state.js';
import { RegistrationService, type OrganizationEventBus } from '../services/registration-service.js';

// A local copy of `expectNoAuditValues` from `@endora-commerce/test-kit/audit`,
// as `organization-audit-sentinels.test.ts` keeps it: this package does not
// depend on the test kit.
type Sentinel = string | number;
type Entry = Record<string, unknown>;

function expectNoAuditValues(entries: readonly Entry[], sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const leaks: string[] = [];
  const hit = (text: string, sentinel: Sentinel) =>
    typeof sentinel === 'number' ? text.includes(String(sentinel)) : text.toLowerCase().includes(sentinel.toLowerCase());
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined || value instanceof Date) return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        for (const sentinel of sentinels) if (typeof sentinel === 'string' && hit(key, sentinel)) leaks.push(`${path}{${key}}`);
        walk(child, `${path}.${key}`);
      }
      return;
    }
    for (const sentinel of sentinels) {
      if (typeof value === 'number' ? value === sentinel : hit(String(value), sentinel)) {
        leaks.push(`${path} = ${JSON.stringify(value)}`);
      }
    }
  };
  entries.forEach((entry, index) => {
    walk(entry['stateBefore'], `[${index}] ${String(entry['action'])} stateBefore`);
    walk(entry['stateAfter'], `[${index}] ${String(entry['action'])} stateAfter`);
  });
  if (leaks.length > 0) {
    throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
  }
}

const ADMIN_ROLE = '00000000-0000-4000-8000-000000176b01';
const ACCOUNT = '00000000-0000-4000-8000-000000176b02';
const CHANNEL = '00000000-0000-4000-8000-000000176b03';

const S = {
  name: 'S176-NAME',
  taxId: 'S176TAXID47',
  street: 'S176-STREET',
  city: 'S176-CITY',
  postalCode: '17-647',
  email: 's176@example.test',
  firstName: 'S176-FIRST',
  lastName: 'S176-LAST',
  customField: 'S176-CF',
} as const;

describe('organization.register — audit state (176 T005, D-288, O-2)', () => {
  it('names the fields and the custom-field keys of both groups, and records no value', async () => {
    const audits: Entry[] = [];
    const audit = {
      recordWithin(_em: EntityManager, input: Entry) {
        audits.push(structuredClone(input));
        return {} as never;
      },
    } as unknown as AuditPort;
    const em: Record<string, unknown> = {
      findOne: async (entity: unknown) => (entity === OrganizationRole ? { id: ADMIN_ROLE } : null),
      execute: async () => [],
      create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
      persistAndFlush: async () => {},
      flush: async () => {},
    };
    em['transactional'] = async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => fn(em as never);
    const events = new EventBus<Record<string, EventBase>>();
    const commandBus = new CommandBus({ em: { fork: () => em } } as unknown as MikroORM, audit, events);
    const accounts: CustomerAccountMemberCommandPort = {
      prepareCreate: async (input: CustomerAccountCreatePreparation) => ({
        command: ({ organizationId, organizationRoleId }) => {
          const command: Command<CustomerAccountRecord> = {
            action: 'customer_account.create',
            objectType: 'customer_account',
            objectId: ACCOUNT,
            // The child's own entry is `customer_accounts`' to hold to the rule
            // (`customer-account-audit-sentinels.test.ts`); this one is skipped.
            run: async () => ({
              result: { id: ACCOUNT, organizationId, organizationRoleId, email: input.email } as CustomerAccountRecord,
              skipAudit: true,
            }),
          };
          return command;
        },
      }),
    };
    const service = new RegistrationService({
      emFactory: () => em as unknown as EntityManager,
      commandBus,
      events: events as unknown as OrganizationEventBus,
      accounts: { read: { findByEmail: async () => null } as never, commands: accounts },
      channelMembership: {
        replaceChannelsForEntity: async () => undefined as never,
        bindToDefaultIfEmpty: async () => undefined as never,
      },
      customFieldValues: { validateForCustomerInput: async (_entityType, values) => ({ ...(values ?? {}) }) },
    });

    const result = await withSystemScope('organizations unit test: organization.register audit state', () =>
      service.registerOrganization(
        {
          organization: {
            name: S.name,
            taxId: S.taxId,
            registeredAddress: { street: S.street, city: S.city, postalCode: S.postalCode, country: 'PL' },
            customFieldValues: { tier: S.customField },
          },
          firstUser: {
            email: S.email,
            password: 'correct horse battery staple',
            firstName: S.firstName,
            lastName: S.lastName,
            customFieldValues: { phone: S.customField },
          },
          acceptedTermsVersion: '1',
        } as RegisterOrganizationRequest,
        { salesChannelId: CHANNEL },
      ),
    );

    expect(audits.map((entry) => entry['action'])).toEqual(['organization.register']);
    expect(audits[0]).toMatchObject({ objectType: 'organization', objectId: result.organization.id, stateBefore: null });
    expectNoAuditValues(audits, [...Object.values(S), result.organization.id]);
    for (const key of Object.keys(audits[0]!['stateAfter'] as object)) {
      expect(ORGANIZATION_AUDIT_KEYS.has(key), key).toBe(true);
    }
    expect(audits[0]!['stateAfter']).toEqual({
      status: 'pending_verification',
      changedFields: ['name', 'registeredAddress', 'taxId'],
      changedCustomFields: ['firstUser.phone', 'organization.tier'],
    });
  });
});
