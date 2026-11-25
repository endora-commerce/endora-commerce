import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS,
  recordMergeScopeReason,
  type CustomerAccountRecord,
  type MembershipChangeInput,
  type OrganizationRecord,
  type RecordMergeRecord,
} from '@endora-commerce/contracts';
import type { CommandContext } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { expectHookableCommand } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import type { CustomerAccount } from '../entities/customer-account.entity.js';
import { makeChangeOrganizationCommand, type ChangeOrganizationCommandDeps } from './customer-account-change-organization.command.js';

/**
 * `specs/192-organization-merge/` T068 (`contracts/membership-merge-mode.md`
 * §4) — `customer_account.organization.change` in the mode `merge`, over an
 * in-memory account: accepted only inside its own merge's scope, exempt from
 * the last-administrator refusal that a `move` meets, the role must be the
 * survivor's, and the event and hook data say `merge`. The batch over a real
 * database, the conformance helper and a hook veto are
 * `backend/test/integration/customer_accounts/organization-merge-participant.test.ts`.
 */

const LOSER = '00000000-0000-4000-8000-000000192e01';
const SURVIVOR = '00000000-0000-4000-8000-000000192e02';
const ACCOUNT = '00000000-0000-4000-8000-000000192e03';
const MERGE = '00000000-0000-4000-8000-000000192e04';
const LOSER_ADMIN = '00000000-0000-4000-8000-000000192e05';
const SURVIVOR_ADMIN = '00000000-0000-4000-8000-000000192e06';
const SURVIVOR_MEMBER = '00000000-0000-4000-8000-000000192e07';

function organization(id: string): OrganizationRecord {
  return { id, isPersonal: false, deletedAt: null, mergedIntoOrganizationId: null } as unknown as OrganizationRecord;
}

function world(options: { mergeState?: RecordMergeRecord['state'] } = {}) {
  const account = {
    id: ACCOUNT,
    organizationId: LOSER,
    organizationRoleId: LOSER_ADMIN,
    deletedAt: null,
  } as unknown as CustomerAccount;
  let flushed = 0;
  let locked = 0;
  const em = {
    findOne: async () => account,
    flush: async () => {
      flushed += 1;
    },
    // The only administrator of the loser: the account itself.
    execute: async () => {
      locked += 1;
      return [{ id: ACCOUNT }];
    },
  };
  const roles: Record<string, Record<string, 'administrator' | 'member'>> = {
    [LOSER]: { [LOSER_ADMIN]: 'administrator' },
    [SURVIVOR]: { [SURVIVOR_ADMIN]: 'administrator', [SURVIVOR_MEMBER]: 'member' },
  };
  const deps: ChangeOrganizationCommandDeps = {
    roles: {
      findRole: async (organizationId, roleId) => {
        const kind = roles[organizationId]?.[roleId];
        return kind ? ({ id: roleId, kind, name: kind } as never) : null;
      },
      predefinedRoleId: async (organizationId, kind) =>
        Object.entries(roles[organizationId] ?? {}).find(([, k]) => k === kind)?.[0] ?? 'missing',
    },
    organizations: () => ({ findById: async (id: string) => organization(id) }),
    recordMerge: () => ({
      getWithin: async () =>
        ({
          id: MERGE,
          hostType: 'organization',
          survivorId: SURVIVOR,
          loserId: LOSER,
          state: options.mergeState ?? 'running',
        }) as RecordMergeRecord,
    }),
    toRecord: async (row) => ({ id: row.id, organizationId: row.organizationId }) as unknown as CustomerAccountRecord,
  };
  const ctx = { em, actor: { kind: 'system', actorAdminUserId: null, impersonatedCustomerAccountId: null } } as unknown as CommandContext;
  return { account, deps, ctx, flushed: () => flushed, locked: () => locked };
}

const mergeInput = (overrides: Partial<MembershipChangeInput> = {}): MembershipChangeInput => ({
  customerAccountId: ACCOUNT,
  organizationId: SURVIVOR,
  organizationRoleId: SURVIVOR_ADMIN,
  source: 'record_merge',
  merge: { mergeId: MERGE, fromOrganizationId: LOSER },
  ...overrides,
});

const inMerge = <T>(run: () => Promise<T>) => withSystemScope(recordMergeScopeReason(MERGE), run);

describe('customer_account.organization.change — the mode merge', () => {
  it('is the hookable action the manifest declares', () => {
    const w = world();
    expectHookableCommand(makeChangeOrganizationCommand(w.deps, mergeInput()), CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS.changeOrganization);
    expect(manifest.hookableActions).toContainEqual(
      expect.objectContaining({ action: 'customer_account.organization.change', objectType: 'customer_account' }),
    );
  });

  it('moves the loser’s last administrator inside its merge, with the mapped role, and says merge', async () => {
    const w = world();
    const command = makeChangeOrganizationCommand(w.deps, mergeInput());
    const outcome = await inMerge(() => command.run(w.ctx));
    expect(w.account).toMatchObject({ organizationId: SURVIVOR, organizationRoleId: SURVIVOR_ADMIN });
    expect(w.locked()).toBe(0);
    expect(outcome.after).toMatchObject({ mode: 'merge', source: 'record_merge', mergeId: MERGE });
    expect(JSON.stringify(outcome.after)).not.toContain(SURVIVOR);
    const event = command.event?.(outcome.result);
    expect(event?.eventName).toBe('customer_account.organization_changed.v1');
    expect(event?.payload).toMatchObject({ mode: 'merge', mergeId: MERGE, fromOrganizationId: LOSER, toOrganizationId: SURVIVOR });
    expect(command.hookData?.(outcome.result)).toMatchObject({ mode: 'merge', mergeId: MERGE });
  });

  it('refuses the last administrator of a company in the mode move', async () => {
    const w = world();
    const { merge: _merge, ...move } = mergeInput({ source: 'operator' });
    await expect(inMerge(() => makeChangeOrganizationCommand(w.deps, move).run(w.ctx))).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORG_OWNER_DEPLETION',
    });
    expect(w.flushed()).toBe(0);
  });

  it('refuses the mode merge outside its merge’s scope', async () => {
    const w = world();
    await expect(withSystemScope('integration', () => makeChangeOrganizationCommand(w.deps, mergeInput()).run(w.ctx))).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECORD_MERGE_IN_PROGRESS',
    });
    expect(w.flushed()).toBe(0);
  });

  it('refuses the mode merge for a merge that is not running, or not between these two', async () => {
    const stopped = world({ mergeState: 'needs_attention' });
    await expect(inMerge(() => makeChangeOrganizationCommand(stopped.deps, mergeInput()).run(stopped.ctx))).rejects.toMatchObject({
      code: 'RECORD_MERGE_IN_PROGRESS',
    });
    const other = world();
    await expect(
      inMerge(() =>
        makeChangeOrganizationCommand(other.deps, mergeInput({ merge: { mergeId: MERGE, fromOrganizationId: SURVIVOR } })).run(other.ctx),
      ),
    ).rejects.toMatchObject({ code: 'RECORD_MERGE_IN_PROGRESS' });
  });

  it('refuses a role that is not the survivor’s', async () => {
    const w = world();
    await expect(inMerge(() => makeChangeOrganizationCommand(w.deps, mergeInput({ organizationRoleId: LOSER_ADMIN })).run(w.ctx))).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(w.flushed()).toBe(0);
  });
});
