import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  type DictionaryValidator,
  type DictionaryWriteMode,
  type OrganizationWriteCreateInput,
} from '@endora-commerce/contracts';
import type { Command, CommandOutcome } from '@endora-commerce/platform/commands';
import { OrganizationWriteService } from './organization-write-port.js';

/**
 * `organizationWritePort` (issue #1029) against an in-memory `EntityManager`
 * and a bus that runs each Command directly, so the action, the audit states
 * and the `skipAudit` decision are read off the outcome exactly as the bus would
 * receive them. The bus itself (one entry, the ambient actor, one transaction)
 * is the platform's and is tested there; the composed port against the database
 * is `backend/test/contract/organizations/organization-write-port.contract.test.ts`.
 */

const CHANNEL_A = '00000000-0000-4000-8000-0000000c0a01';
const CHANNEL_B = '00000000-0000-4000-8000-0000000c0a02';
const UNKNOWN_CHANNEL = '00000000-0000-4000-8000-0000000c0aff';

type Row = Record<string, unknown> & { id: string };

/** Just enough of `EntityManager` for the two Commands and the port's reads. */
class MemoryEm {
  readonly tables = new Map<string, Row[]>([
    ['Organization', []],
    ['SalesChannel', [{ id: CHANNEL_A }, { id: CHANNEL_B }]],
  ]);
  flushes = 0;

  #rows(entity: { name: string }): Row[] {
    const rows = this.tables.get(entity.name);
    if (!rows) throw new Error(`MemoryEm: no table for ${entity.name}`);
    return rows;
  }

  #matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, expected]) => {
      const actual = row[key] ?? null;
      if (expected && typeof expected === 'object' && '$in' in expected) {
        return (expected as { $in: unknown[] }).$in.includes(actual);
      }
      return actual === expected;
    });
  }

  async findOne(entity: { name: string }, where: Record<string, unknown>): Promise<Row | null> {
    return this.#rows(entity).find((row) => this.#matches(row, where)) ?? null;
  }

  async find(entity: { name: string }, where: Record<string, unknown>): Promise<Row[]> {
    return this.#rows(entity).filter((row) => this.#matches(row, where));
  }

  create(entity: { name: string }, data: Record<string, unknown>): Row {
    const row: Row = {
      id: randomUUID(),
      legalName: null,
      vatStatus: 'vat_payer',
      isPersonal: false,
      orderConfirmationEmails: [],
      customFieldValues: {},
      path: '/',
      version: 1,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-01T00:00:00Z'),
      deletedAt: null,
      ...data,
    };
    this.#rows(entity).push(row);
    return row;
  }

  async flush(): Promise<void> {
    this.flushes += 1;
  }

  /**
   * `organization.create`'s raw reads: the tax-ID policy row (none here, so
   * `global`) and whether any row — a soft-deleted one included — holds the
   * normalised tax ID.
   */
  async execute(sql: string, params: unknown[] = []): Promise<unknown[]> {
    if (sql.includes('"tax_id" = ?')) {
      return this.#rows({ name: 'Organization' }).filter((row) => row['taxId'] === params[0]).map(() => ({ '?column?': 1 }));
    }
    return [];
  }

  seedOrganization(values: Partial<Row> = {}): Row {
    const id = randomUUID();
    return this.create({ name: 'Organization' }, {
      id,
      path: `/${id}/`,
      name: 'Seeded Co',
      taxId: `PL${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
      status: 'active',
      registeredAddress: { street: 'ul. Stara 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
      ...values,
    });
  }
}

interface RanCommand {
  action: string;
  objectType: string;
  objectId: string;
  outcome: CommandOutcome<unknown>;
}

function harness(options: { refuseCountry?: string } = {}) {
  const em = new MemoryEm();
  const ran: RanCommand[] = [];
  const bound: Array<{ entityId: string; channelIds: readonly string[] }> = [];
  const countryChecks: Array<{ code: string; mode: DictionaryWriteMode }> = [];
  const lookups: string[] = [];
  const validatedValues: Array<Record<string, unknown>> = [];
  const commandBus = {
    run: async <T>(command: Command<T>): Promise<T> => {
      const outcome = await command.run({
        em: em as unknown as EntityManager,
        actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, actorCustomerAccountId: null, kind: 'system' },
      });
      ran.push({ action: command.action, objectType: command.objectType, objectId: command.objectId, outcome });
      return outcome.result;
    },
  };
  const dictionaryValidator: Pick<DictionaryValidator, 'validateCountryCode'> = {
    validateCountryCode: async (code, mode) => {
      countryChecks.push({ code, mode });
      if (code === options.refuseCountry) {
        throw new DictionaryReferenceError({ code: 'DICTIONARY_ENTRY_INACTIVE', entryType: 'country', entryCode: code });
      }
    },
  };
  const port = new OrganizationWriteService({
    commandBus,
    emFactory: () => em as unknown as EntityManager,
    membership: {
      replaceChannelsForEntity: async (_type, entityId, channelIds) => {
        bound.push({ entityId, channelIds });
        return { changed: true };
      },
    },
    dictionaryValidator,
    lookup: {
      findByTaxId: async (taxId) => {
        lookups.push(taxId);
        return [];
      },
    },
    tree: { assertMaxDepth: async () => {} },
    customFieldValues: {
      validateAndMerge: async (_entityType, current, values) => {
        validatedValues.push(values ?? {});
        return { ...current, ...values };
      },
    },
  });
  return { em, port, ran, bound, countryChecks, lookups, validatedValues };
}

function createInput(overrides: Partial<OrganizationWriteCreateInput> = {}): OrganizationWriteCreateInput {
  return {
    name: 'ERP Customer Co',
    legalName: 'ERP Customer Co sp. z o.o.',
    taxId: 'PL5260001246',
    vatStatus: 'vat_payer',
    registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
    salesChannelIds: [CHANNEL_A],
    status: 'active',
    ...overrides,
  };
}

async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { statusCode?: number; code?: string };
    return { statusCode: e.statusCode ?? 0, code: e.code ?? '' };
  }
  throw new Error('expected a refusal');
}

describe('organizationWritePort — findByTaxId', () => {
  it('is the read model\'s lookup: every live holder, as a list', async () => {
    const { port, lookups } = harness();
    expect(await port.findByTaxId('pl 526-000-12-46')).toEqual([]);
    // The read model normalises; the port hands the input over unchanged.
    expect(lookups).toEqual(['pl 526-000-12-46']);
  });
});

describe('organizationWritePort — create', () => {
  it('runs organization.create, binds the channels and records the legal name', async () => {
    const { port, ran, bound } = harness();
    const record = await port.create(
      createInput({ taxId: 'pl 526-000-12-46', salesChannelIds: [CHANNEL_A, CHANNEL_B] }),
    );

    expect(record).toMatchObject({
      name: 'ERP Customer Co',
      legalName: 'ERP Customer Co sp. z o.o.',
      taxId: 'PL5260001246',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
    });
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ action: 'organization.create', objectType: 'organization', objectId: record.id });
    // Names, not values (`specs/conventions/audit-state.md`).
    expect(ran[0]!.outcome.after).toMatchObject({
      status: 'active',
      vatStatus: 'vat_payer',
      changedFields: ['legalName', 'name', 'registeredAddress', 'taxId'],
      salesChannelIds: [CHANNEL_A, CHANNEL_B].sort(),
    });
    expect(JSON.stringify(ran[0]!.outcome.after)).not.toContain('ERP Customer Co');
    expect(bound).toEqual([{ entityId: record.id, channelIds: [CHANNEL_A, CHANNEL_B] }]);
  });

  it('creates a branch under a live parent and validates custom-field values, as the admin create does', async () => {
    const { em, port, validatedValues } = harness();
    const parent = em.seedOrganization();
    const record = await port.create(
      createInput({ parentId: parent.id, customFieldValues: { erp_code: 'K-100' } }),
    );
    expect(record).toMatchObject({ parentId: parent.id, customFieldValues: { erp_code: 'K-100' } });
    expect(record.path).toBe(`${parent['path'] as string}${record.id}/`);
    expect(validatedValues).toEqual([{ erp_code: 'K-100' }]);

    expect(await refusal(port.create(createInput({ parentId: randomUUID() })))).toEqual({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('checks the country as the admin create does, and refuses one an operator has not made available', async () => {
    const accepted = harness();
    await accepted.port.create(createInput());
    expect(accepted.countryChecks).toEqual([{ code: 'PL', mode: 'create-or-change' }]);

    const refused = harness({ refuseCountry: 'DE' });
    const registeredAddress = { street: 'Hauptstr. 1', city: 'Berlin', postalCode: '10115', country: 'DE' };
    expect(await refusal(refused.port.create(createInput({ registeredAddress })))).toEqual({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_INACTIVE',
    });
    expect(refused.ran).toHaveLength(0);
  });

  it('refuses a tax id another Organization holds — a soft-deleted one included', async () => {
    const { em, port, ran } = harness();
    em.seedOrganization({ taxId: 'PL5260001246', deletedAt: new Date() });

    expect(await refusal(port.create(createInput({ taxId: 'PL 526 000 12 46' })))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
    });
    expect(ran).toHaveLength(0);
  });

  it('refuses an unknown sales channel before anything is written', async () => {
    const { em, port, ran } = harness();
    expect(await refusal(port.create(createInput({ salesChannelIds: [CHANNEL_A, UNKNOWN_CHANNEL] })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.UNKNOWN_SALES_CHANNEL,
    });
    expect(ran).toHaveLength(0);
    expect(em.tables.get('Organization')).toHaveLength(0);
  });

  it('refuses an input outside the admin API limits with VALIDATION_FAILED', async () => {
    const { port, ran } = harness();
    for (const input of [
      createInput({ name: '' }),
      createInput({ taxId: 'PL1' }),
      createInput({ registeredAddress: { street: 'x', city: 'y', postalCode: 'z', country: 'POL' } }),
      createInput({ salesChannelIds: [CHANNEL_A, CHANNEL_A] }),
      createInput({ salesChannelIds: [] as unknown as [string] }),
    ]) {
      expect(await refusal(port.create(input)), JSON.stringify(input)).toEqual({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    }
    expect(ran).toHaveLength(0);
  });
});

describe('organizationWritePort — update', () => {
  it('runs organization.update over the identity fields, with only those in the audit states', async () => {
    const { em, port, ran } = harness();
    const org = em.seedOrganization({ name: 'Old Co', legalName: null, orderConfirmationEmails: [] });

    const record = await port.update(org.id, {
      name: 'New Co',
      legalName: 'New Co S.A.',
      vatStatus: 'vat_exempt',
      registeredAddress: { street: 'ul. Nowa 2', city: 'Gdynia', postalCode: '81-001', country: 'PL' },
      orderConfirmationEmails: ['orders@new.example'],
    });

    expect(record).toMatchObject({
      id: org.id,
      name: 'New Co',
      legalName: 'New Co S.A.',
      vatStatus: 'vat_exempt',
      registeredAddress: { street: 'ul. Nowa 2', city: 'Gdynia', postalCode: '81-001', country: 'PL' },
      orderConfirmationEmails: ['orders@new.example'],
    });
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ action: 'organization.update', objectType: 'organization', objectId: org.id });
    expect(ran[0]!.outcome.skipAudit).toBeFalsy();
    // Names, not values (`specs/conventions/audit-state.md`, issue #470).
    expect(ran[0]!.outcome.before).toEqual({ vatStatus: 'vat_payer' });
    expect(ran[0]!.outcome.after).toEqual({
      vatStatus: 'vat_exempt',
      changedFields: ['legalName', 'name', 'orderConfirmationEmails', 'registeredAddress', 'vatStatus'],
    });
  });

  it('leaves an absent key as it is, and clears the legal name on null', async () => {
    const { em, port, ran } = harness();
    const org = em.seedOrganization({ name: 'Keep Co', legalName: 'Keep Co Ltd' });
    const record = await port.update(org.id, { legalName: null });
    expect(record).toMatchObject({ name: 'Keep Co', legalName: null });
    expect(ran.at(-1)!.outcome.after).toEqual({ vatStatus: 'vat_payer', changedFields: ['legalName'] });
  });

  it('writes and records nothing when the patch changes nothing', async () => {
    const { em, port, ran } = harness();
    const org = em.seedOrganization({ name: 'Same Co' });
    const flushesBefore = em.flushes;
    await port.update(org.id, { name: 'Same Co', registeredAddress: { ...(org['registeredAddress'] as object) } as never });
    expect(ran).toHaveLength(1);
    expect(ran[0]!.outcome.skipAudit).toBe(true);
    expect(em.flushes).toBe(flushesBefore);
  });

  it('checks a changed country as a change, and an unchanged one as unchanged', async () => {
    const { em, port, countryChecks } = harness();
    const org = em.seedOrganization();
    await port.update(org.id, { registeredAddress: { street: 'a', city: 'b', postalCode: 'c', country: 'PL' } });
    await port.update(org.id, { registeredAddress: { street: 'a', city: 'b', postalCode: 'c', country: 'CZ' } });
    expect(countryChecks).toEqual([
      { code: 'PL', mode: 'unchanged' },
      { code: 'CZ', mode: 'create-or-change' },
    ]);
  });

  it('refuses an unknown, a soft-deleted and a non-uuid id with NOT_FOUND', async () => {
    const { em, port } = harness();
    const deleted = em.seedOrganization({ deletedAt: new Date() });
    for (const id of [randomUUID(), deleted.id, 'not-a-uuid']) {
      expect(await refusal(port.update(id, { name: 'X' })), id).toEqual({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
    }
  });

  it('refuses a stale expectedVersion with VERSION_CONFLICT and accepts the current one', async () => {
    const { em, port, ran } = harness();
    const org = em.seedOrganization({ version: 4 });
    expect(await refusal(port.update(org.id, { name: 'Stale' }, { expectedVersion: 3 }))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
    });
    expect(org['name']).toBe('Seeded Co');
    expect(ran).toHaveLength(0);
    expect((await port.update(org.id, { name: 'Fresh' }, { expectedVersion: 4 })).name).toBe('Fresh');
  });

  it('refuses a patch outside the limits with VALIDATION_FAILED', async () => {
    const { em, port } = harness();
    const org = em.seedOrganization();
    for (const patch of [
      { name: '' },
      { legalName: 'x'.repeat(256) },
      { orderConfirmationEmails: ['not-an-email'] },
      { registeredAddress: { street: '', city: 'b', postalCode: 'c', country: 'PL' } },
      // The tax ID is not this port's to change (`OrganizationCommandPort.changeTaxId` is).
      { taxId: 'PL9999999999' } as never,
    ]) {
      expect(await refusal(port.update(org.id, patch)), JSON.stringify(patch)).toEqual({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    }
    expect(await refusal(port.update(org.id, {}, { expectedVersion: -1 }))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });
});
