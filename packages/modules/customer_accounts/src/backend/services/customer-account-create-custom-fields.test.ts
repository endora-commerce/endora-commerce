import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAccountMemberWriteService } from './customer-account-ports.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` research R-5, FR-025): the
 * account create stores the custom-field bag its caller hands in. The caller —
 * the registration surface or the admin member create — has already validated
 * it through custom_fields' value port, so this module stores it as given and
 * never re-validates (a second validation would run after the Organization
 * flush, the window FR-024 closes).
 */

const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000c1751';
const ROLE_ID = '00000000-0000-4000-8000-0000000c1752';

function harness() {
  const created: Record<string, unknown>[] = [];
  const em = {
    findOne: async () => null,
    create: (entity: unknown, data: Record<string, unknown>) => {
      if (entity !== CustomerAccount) throw new Error('unexpected entity');
      created.push(data);
      return Object.assign(Object.create(CustomerAccount.prototype) as CustomerAccount, {
        id: '00000000-0000-4000-8000-0000000c1753',
        createdAt: new Date(),
        updatedAt: new Date(),
        subtreeRollupEnabled: false,
        ...data,
      });
    },
    persistAndFlush: async () => undefined,
    transactional: async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => fn(em),
    fork: () => em,
  } as unknown as EntityManager;
  // The creation is the `customer_account.create` Command since
  // `specs/176-command-hooks-outbox/` (FR-004), so it runs on a bus.
  const bus = new CommandBus({ em } as never, { recordWithin: () => ({}) } as never, {
    run: async <T>(fn: () => Promise<T>) => fn(),
    emit: () => undefined,
  } as never);
  const members = new CustomerAccountMemberWriteService(() => em, async () => new Set<string>(), undefined, {
    commandBus: bus,
  });
  const service = {
    create: (input: Parameters<typeof members.create>[0]) =>
      withSystemScope('customer_accounts unit test: account custom-field values', () => members.create(input)),
  };
  return { service, created };
}

const BASE = {
  organizationId: ORGANIZATION_ID,
  email: 'ada@example.com',
  password: 'correct horse battery staple',
  firstName: 'Ada',
  lastName: 'Lovelace',
  organizationRoleId: ROLE_ID,
};

describe('CustomerAccountMemberWriteService.create — custom-field values (feature 175)', () => {
  it('persists the bag exactly as given', async () => {
    const { service, created } = harness();
    const bag = { phone: '+48 600 000 000', newsletter: true };

    const record = await service.create({ ...BASE, customFieldValues: bag });

    expect(created[0]!['customFieldValues']).toEqual(bag);
    expect(record.customFieldValues).toEqual(bag);
  });

  it('writes an empty bag when the caller sends none', async () => {
    const { service, created } = harness();

    const record = await service.create(BASE);

    expect(created[0]!['customFieldValues']).toEqual({});
    expect(record.customFieldValues).toEqual({});
  });
});
