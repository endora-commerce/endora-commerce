/**
 * `CustomerAccountMemberWritePort.create` (`specs/176-command-hooks-outbox/`
 * T003, FR-004): the port keeps its contract and runs the one
 * `customer_account.create` Command through the bus, so the creation has one
 * implementation and the bus writes its one audit entry. The port's own
 * hand-written audit call for the creation is gone (Principle XIII).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CommandBus, type Command } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { CustomerAccountMemberWriteService } from './customer-account-ports.js';

const ORG = randomUUID();
const ROLE = randomUUID();

function recorder() {
  const entries: RecordAuditInput[] = [];
  return {
    entries,
    audit: {
      recordWithin: (_em: unknown, input: RecordAuditInput) => {
        entries.push(input);
        return input as never;
      },
      record: async (input: RecordAuditInput) => {
        entries.push(input);
        return input as never;
      },
    },
  };
}

function fakeEm() {
  const rows: object[] = [];
  const em = {
    create: <T extends object>(entity: new () => T, data: Partial<T>): T => Object.assign(new entity(), data),
    findOne: async () => null,
    persistAndFlush: async (row: object) => {
      rows.push(row);
    },
    transactional: async <T>(fn: (inner: unknown) => Promise<T>): Promise<T> => fn(em),
    fork: () => em,
  };
  return { em, rows };
}

const INPUT = {
  organizationId: ORG,
  email: 'ada@example.test',
  password: 'correct horse battery staple',
  firstName: 'Ada',
  lastName: 'Lovelace',
  organizationRoleId: ROLE,
};

const asSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScope('customer_accounts unit test: the member write port', fn);

describe('CustomerAccountMemberWriteService.create — runs the Command (176 T003)', () => {
  it('runs customer_account.create through the bus; the port writes no audit entry of its own', async () => {
    const { em, rows } = fakeEm();
    const viaBus = recorder();
    const direct = recorder();
    const bus = new CommandBus({ em } as never, viaBus.audit as never, {
      run: async <T>(fn: () => Promise<T>) => fn(),
      emit: vi.fn(),
    } as never);
    const run = vi.spyOn(bus, 'run');
    const service = new CustomerAccountMemberWriteService(() => em as never, async () => new Set<string>(), direct.audit as never, {
      commandBus: bus,
    });

    const record = await asSystem(() => service.create(INPUT));

    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as Command<unknown>;
    expect(command).toMatchObject({ action: 'customer_account.create', objectType: 'customer_account', objectId: record.id });
    expect(viaBus.entries.map((entry) => entry.action)).toEqual(['customer_account.create']);
    expect(direct.entries).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(record).toMatchObject({ organizationId: ORG, organizationRoleId: ROLE, email: INPUT.email });
  });

  it('refuses without a bus rather than writing unaudited', async () => {
    const { em, rows } = fakeEm();
    const service = new CustomerAccountMemberWriteService(() => em as never, async () => new Set<string>());

    await expect(asSystem(() => service.create(INPUT))).rejects.toThrow(/Command/);
    expect(rows).toEqual([]);
  });
});
