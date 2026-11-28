/**
 * `customer_account.register_social` (`specs/193-admin-form-extensions/`
 * D-300.10, D-300.31): the federated sign-in's account and personal
 * organisation as one Command — a buyer's own write, so it says so and its
 * child provisioning inherits it — recording the entry the seam used to write
 * by hand.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '@endora-commerce/platform/commands';
import { manifest } from '../../manifest.js';
import { makeRegisterSocialCommand } from './customer-account-register-social.command.js';

const ACCOUNT = '00000000-0000-4000-8000-000000193c01';
const ORG = '00000000-0000-4000-8000-000000193c02';
const ROLE = '00000000-0000-4000-8000-000000193c03';
const CHANNEL = '00000000-0000-4000-8000-000000193c04';

describe('customer_account.register_social', () => {
  it('is a buyer self-service action the manifest lists', () => {
    expect(manifest.buyerSelfServiceActions).toContain('customer_account.register_social');
  });

  it('provisions the personal organisation as its child, then writes the account on the same em, recording names only', async () => {
    const calls: { em: unknown; run: unknown; input: unknown }[] = [];
    const persisted: Record<string, unknown>[] = [];
    const em = {
      create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
      persist: (row: Record<string, unknown>) => {
        persisted.push(row);
        return { flush: async () => undefined };
      },
    };
    const run = async <T>(command: Command<T>): Promise<T> => (await command.run({ em } as never)).result;
    const command = makeRegisterSocialCommand(
      {
        personalOrganizations: {
          provisionFor: async (context, input) => {
            calls.push({ em: context.em, run: context.run, input });
            return { id: ORG, administratorRoleId: ROLE };
          },
        },
      },
      { customerAccountId: ACCOUNT, email: 'ada@example.test', passwordHash: 'h', salesChannelId: CHANNEL, preferredLanguage: 'pl' },
    );
    expect(command).toMatchObject({ action: 'customer_account.register_social', objectType: 'customer_account', objectId: ACCOUNT, buyerSelfService: true });

    const outcome = await command.run({ em, run } as never);

    expect(calls).toEqual([{ em, run, input: { customerAccountId: ACCOUNT, email: 'ada@example.test', salesChannelId: CHANNEL } }]);
    expect(persisted[0]).toMatchObject({ id: ACCOUNT, organizationId: ORG, organizationRoleId: ROLE, passwordSetAt: null, preferredLanguage: 'pl' });
    expect(outcome.result).toEqual({ id: ACCOUNT, organizationId: ORG });
    expect(outcome.before).toBeNull();
    expect(JSON.stringify(outcome.after)).not.toContain('ada@example.test');
  });
});
