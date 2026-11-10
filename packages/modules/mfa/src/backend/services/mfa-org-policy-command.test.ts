import { describe, expect, it } from 'vitest';
import type { Command, CommandBus, CommandContext } from '@endora-commerce/platform/commands';
import { MfaOrgPolicyService } from './mfa-org-policy-service.js';

/**
 * Issue #983 — an organization's 2FA enforcement is written through
 * `CommandBus.run` (Constitution XIII), so the bus records its one audit entry
 * co-transactionally: `mfa.org_enforced` on the `organization`, as the two
 * routes recorded it by hand before.
 */
function fakeEm(existing: { enforceTotp: boolean; updatedByActor?: string } | null) {
  const writes: unknown[] = [];
  const em = {
    async findOne() {
      return existing;
    },
    create(_entity: unknown, data: Record<string, unknown>) {
      return { ...data };
    },
    persist(row: unknown) {
      writes.push(row);
    },
    async flush() {
      writes.push('flush');
    },
  };
  return { em, emFactory: () => em as never, writes };
}

function recordingBus(em: unknown) {
  const commands: Command<unknown>[] = [];
  const outcomes: unknown[] = [];
  const bus = {
    async run<T>(command: Command<T>): Promise<T> {
      commands.push(command as Command<unknown>);
      const ctx = { em, actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' } };
      const outcome = await command.run(ctx as unknown as CommandContext);
      outcomes.push(outcome);
      return outcome.result;
    },
  };
  return { bus: bus as unknown as CommandBus, commands, outcomes };
}

describe('MfaOrgPolicyService runs its write through the Command Bus (issue #983)', () => {
  it('runs one mfa.org_enforced command on the organization', async () => {
    const { em, emFactory } = fakeEm(null);
    const { bus, commands, outcomes } = recordingBus(em);
    const service = new MfaOrgPolicyService(emFactory, bus);

    await expect(service.setEnforcement('org-1', true, 'admin-1')).resolves.toEqual({ enforceTotp: true });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      action: 'mfa.org_enforced',
      objectType: 'organization',
      objectId: 'org-1',
    });
    expect(outcomes[0]).toMatchObject({ before: null, after: { enforceTotp: true } });
  });

  it('writes on the transactional em the bus hands it, and records the prior value as the before-state', async () => {
    const existing = { enforceTotp: true, updatedByActor: 'someone' };
    const { em, emFactory } = fakeEm(existing);
    const { bus, outcomes } = recordingBus(em);
    const service = new MfaOrgPolicyService(emFactory, bus);

    await service.setEnforcement('org-1', false, 'admin-2');

    expect(existing).toEqual({ enforceTotp: false, updatedByActor: 'admin-2' });
    expect(outcomes[0]).toMatchObject({ before: { enforceTotp: true }, after: { enforceTotp: false } });
  });
});
