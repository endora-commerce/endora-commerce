import { describe, expect, it } from 'vitest';
import type { AuditReferenceRegistryPort, AuditReferenceResolver } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { registerCustomerAccountAuditReferences } from './audit-references.js';

/**
 * What a customer is called on an audit row (issue #741, owner ruling on PR
 * #744): the person — `<first> <last> (<e-mail>)`, or the e-mail alone when the
 * account has no name. The same label names a customer who acted for
 * themselves on the storefront and an impersonated customer.
 */

interface AccountRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

function resolverOver(rows: AccountRow[]): AuditReferenceResolver {
  let registered: AuditReferenceResolver | undefined;
  const registry = {
    register: (resolver: AuditReferenceResolver) => {
      registered = resolver;
    },
  } as unknown as AuditReferenceRegistryPort;
  const em = {
    find: async (_entity: unknown, where: { id: { $in: string[] } }) =>
      rows.filter((r) => where.id.$in.includes(r.id)),
  } as unknown as EntityManager;
  registerCustomerAccountAuditReferences(registry, () => em);
  return registered!;
}

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const C = '00000000-0000-4000-8000-0000000000c3';

describe('the customer_account audit reference', () => {
  it('is registered by customer_accounts for its own type', () => {
    const resolver = resolverOver([]);
    expect(resolver).toMatchObject({ ownerModuleId: 'customer_accounts', referenceType: 'customer_account' });
  });

  it('names the person, with the e-mail beside the name', async () => {
    const resolver = resolverOver([
      { id: A, email: 'buyer@example.com', firstName: 'Demo', lastName: 'Buyer' },
    ]);
    expect(await resolver.resolve([A])).toEqual([
      { id: A, label: 'Demo Buyer (buyer@example.com)', url: null },
    ]);
  });

  it('falls back to the e-mail alone when the account has no name', async () => {
    const resolver = resolverOver([
      { id: B, email: 'nameless@example.com', firstName: '  ', lastName: '' },
      { id: C, email: 'first-only@example.com', firstName: 'Ola', lastName: '' },
    ]);
    expect(await resolver.resolve([B, C])).toEqual([
      { id: B, label: 'nameless@example.com', url: null },
      { id: C, label: 'Ola (first-only@example.com)', url: null },
    ]);
  });

  it('omits an id it has no account for, so the reader falls back to the id', async () => {
    const resolver = resolverOver([]);
    expect(await resolver.resolve([A])).toEqual([]);
  });
});
