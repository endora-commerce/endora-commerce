import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
  CustomerAccountRecord,
} from '@endora-commerce/contracts';
import { PersonalOrganizationService } from './personal-organization-service.js';

/**
 * `specs/177-tax-id-scope/` FR-003 (T011, unit half) — personal provisioning is
 * idempotent by the **account link**, not by a tax ID.
 *
 * A personal organization has no tax ID from this release on, so the row is
 * found by `personalAccountId` and created with `taxId: null`. The in-memory
 * `EntityManager` below answers `findOne` from what `create` stored, so a
 * second provisioning for one account re-finds the first row — and only by
 * the filter the service actually sends.
 */
function memoryEm() {
  const rows: Array<Record<string, unknown>> = [];
  const filters: Array<Record<string, unknown>> = [];
  const em = {
    findOne: vi.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      filters.push(where);
      return (
        rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ??
        null
      );
    }),
    create: vi.fn((_entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `org-${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    }),
    persistAndFlush: vi.fn(async () => undefined),
  };
  return { em: em as unknown as EntityManager, rows, filters };
}

const ACCOUNT = '79963f23-3e38-43bd-84e1-44a8fcdd37f8';

function build(options: { em?: EntityManager; account?: Partial<CustomerAccountRecord> } = {}) {
  const read = {
    findById: vi.fn(async (id: string) => ({
      id,
      email: 'solo@example.test',
      firstName: 'Jane',
      lastName: 'Doe',
      organizationId: null,
      ...options.account,
    })),
  } as unknown as CustomerAccountReadPort;
  const service = new PersonalOrganizationService(
    () => {
      if (!options.em) throw new Error('no EntityManager for this case');
      return options.em;
    },
    { read, write: {} as CustomerAccountMemberWritePort },
    undefined,
    {
      bindToDefaultIfEmpty: vi.fn(async () => ({ changed: true })),
      replaceChannelsForEntity: vi.fn(async () => ({ changed: true })),
    },
  );
  return service;
}

describe('PersonalOrganizationService — provisioning by the account link [unit]', () => {
  it('creates the personal organization with no tax ID and the account link set', async () => {
    const { em, rows } = memoryEm();
    const org = await build().provisionFor(em, { customerAccountId: ACCOUNT, email: 'solo@example.test' });
    expect(rows).toHaveLength(1);
    expect(org.taxId).toBeNull();
    expect(org.personalAccountId).toBe(ACCOUNT);
    expect(org.isPersonal).toBe(true);
  });

  it('a second provisioning for the same account answers the same row', async () => {
    const { em, rows, filters } = memoryEm();
    const service = build();
    const first = await service.provisionFor(em, { customerAccountId: ACCOUNT, email: 'solo@example.test' });
    const second = await service.provisionFor(em, { customerAccountId: ACCOUNT, email: 'solo@example.test' });
    expect(second).toBe(first);
    expect(rows).toHaveLength(1);
    // Found by the link, never by a tax ID.
    expect(filters.every((where) => 'personalAccountId' in where && !('taxId' in where))).toBe(true);
  });

  it('two accounts get two personal organizations', async () => {
    const { em, rows } = memoryEm();
    const service = build();
    await service.provisionFor(em, { customerAccountId: ACCOUNT, email: 'a@example.test' });
    await service.provisionFor(em, {
      customerAccountId: '00000000-0000-4000-8000-000000000002',
      email: 'b@example.test',
    });
    expect(rows).toHaveLength(2);
  });

  it('the unassign destination is the account’s own personal organization even while it belongs to a company', async () => {
    const memory = memoryEm();
    const own = await build().provisionFor(memory.em, { customerAccountId: ACCOUNT, email: 'solo@example.test' });
    const service = build({
      em: memory.em,
      account: { organizationId: '00000000-0000-4000-8000-0000000000c0' },
    });
    const destination = await service.provisionPersonalOrganizationFor(ACCOUNT);
    expect(destination).toBe(own);
    expect(memory.rows).toHaveLength(1);
  });
});
