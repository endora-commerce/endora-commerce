import { randomUUID } from 'node:crypto';
import { asValue, type AwilixContainer } from 'awilix';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS,
  CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT,
  defineModuleErrorCodes,
  type MembershipPort,
  type OrganizationRoleReadPort,
} from '@endora-commerce/contracts';
import { CommandBus, CommandHookRefusal, type Command } from '@endora-commerce/platform/commands';
import type { AuditPort, RecordMergeService } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  expectOrganizationParticipantConforms,
  insertOrganizationPair,
} from '../../helpers/organization-merge-conformance.js';
import { CustomerAccountMergeParticipant } from '../../../../packages/modules/customer_accounts/src/backend/merge/organization-merge-participant.js';
import { manifest as customerAccountsManifest } from '../../../../packages/modules/customer_accounts/src/manifest.js';

/** The hook module of the veto case, as a deployment's overlay would register it. */
const VETO_MODULE = 'merge_veto_fixture';
const VETO = defineModuleErrorCodes(['MERGE_VETO_FIXTURE_REFUSED']);

/**
 * `specs/192-organization-merge/` T068 – T070 — the `customer_accounts`
 * participant of an Organization merge over a real database: the loser's
 * members (a removed one included) move to the survivor in the `members` phase,
 * one `customer_account.organization.change` per account in the mode `merge`,
 * each with the role the host's role map names — held to
 * `expectMergeParticipant` (events not counted: this step announces
 * `customer_account.organization_changed.v1` with `mode: 'merge'` by
 * contract, R-5) — and the published `membershipPort` refusing the mode
 * outside a running merge's scope.
 */
describe('Organization merge — the customer_accounts participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const cradle = () =>
    h.container.cradle as unknown as {
      membershipPort: MembershipPort;
      organizationRoleReadPort: OrganizationRoleReadPort;
      recordMergeService: RecordMergeService;
    };

  const sql = <T = unknown>(statement: string, params: unknown[] = []): Promise<T> =>
    h.em().fork().getConnection().execute(statement, params) as Promise<T>;

  /** The predefined roles the Organization's insert gave it (a trigger of `organizations`). */
  async function roles(organizationId: string): Promise<{ administrator: string; member: string }> {
    const rows = await sql<Array<{ id: string; kind: 'administrator' | 'member' }>>(
      `select "id","kind" from "organization_roles" where "organization_id" = ? and "kind" in ('administrator','member')`,
      [organizationId],
    );
    const of = (kind: string) => rows.find((row) => row.kind === kind)!.id;
    return { administrator: of('administrator'), member: of('member') };
  }

  async function account(organizationId: string, roleId: string, options: { removed?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "customer_accounts" ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id","deleted_at","created_at","updated_at")
       values (?, ?, ?, 'x', 'Merge', 'Member', ?, ?, now(), now())`,
      [id, organizationId, `merge-${id}@example.test`, roleId, options.removed ? new Date() : null],
    );
    return id;
  }

  it('moves every member of the loser with its mapped role, one audited Command each (conformance)', async () => {
    const ids = await insertOrganizationPair(h);
    const loserRoles = await roles(ids.loserId);
    const survivorRoles = await roles(ids.survivorId);
    const announced: Array<{ mode: string; mergeId: string | null }> = [];
    const off = h.eventBus.on(CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT, (payload) => {
      announced.push(payload as never);
    });
    const accounts: string[] = [];
    // The members phase reads the merge record: a running merge between the two.
    const outcome = await withRunningMerge(ids, (mergeId) =>
      expectOrganizationParticipantConforms({
        h,
        moduleId: 'customer_accounts',
        key: 'organization-members',
        ids: { ...ids, mergeId },
        batchSize: 2,
        countEvents: false,
        hostContext: { roleMap: { [loserRoles.administrator]: survivorRoles.administrator, [loserRoles.member]: survivorRoles.member } },
        build: (commandBus: Pick<CommandBus, 'run'>) =>
          new CustomerAccountMergeParticipant({
            emFactory: () => h.em(),
            roles: cradle().organizationRoleReadPort,
            changeOrganization: async (input) => {
              const result = await commandBus.run(cradle().membershipPort.changeCommand(input) as unknown as Command<{ changed: boolean }>);
              return { changed: result.changed };
            },
          }),
        seed: async ({ survivorId, loserId }) => {
          accounts.push(await account(loserId, loserRoles.administrator));
          accounts.push(await account(loserId, loserRoles.member));
          accounts.push(await account(loserId, loserRoles.member, { removed: true }));
          await account(survivorId, survivorRoles.administrator);
        },
        snapshot: ({ survivorId, loserId }) =>
          sql(`select "id","organization_id","organization_role_id" from "customer_accounts" where "organization_id" in (?, ?) order by "id"`, [
            survivorId,
            loserId,
          ]),
      }),
    );
    off();
    expect(outcome.moved).toBe(3);
    const moved = await sql<Array<{ id: string; organization_id: string; organization_role_id: string }>>(
      `select "id","organization_id","organization_role_id" from "customer_accounts" where "id" in (?, ?, ?) order by "id"`,
      accounts,
    );
    const roleOf = new Map(moved.map((row) => [row.id, row.organization_role_id]));
    expect(moved.every((row) => row.organization_id === ids.survivorId)).toBe(true);
    expect(roleOf.get(accounts[0]!)).toBe(survivorRoles.administrator);
    expect(roleOf.get(accounts[1]!)).toBe(survivorRoles.member);
    expect(announced).toHaveLength(3);
    expect(announced.every((event) => event.mode === 'merge' && event.mergeId === outcome.mergeId)).toBe(true);
    const audit = await sql<Array<{ action: string; object_type: string }>>(
      `select "action","object_type" from "audit_log_entries" where "state_after" ->> 'mergeId' = ?`,
      [outcome.mergeId],
    );
    expect(audit).toHaveLength(3);
    expect(audit.every((entry) => entry.action === 'customer_account.organization.change' && entry.object_type === 'customer_account')).toBe(true);
  });

  it('refuses the mode merge outside a running merge (membership-merge-mode §2.1)', async () => {
    const ids = await insertOrganizationPair(h);
    const loserRoles = await roles(ids.loserId);
    const survivorRoles = await roles(ids.survivorId);
    const id = await account(ids.loserId, loserRoles.administrator);
    await expect(
      withSystemScope('integration', () =>
        cradle().membershipPort.changeOrganization({
          customerAccountId: id,
          organizationId: ids.survivorId,
          organizationRoleId: survivorRoles.administrator,
          source: 'integration',
          merge: { mergeId: randomUUID(), fromOrganizationId: ids.loserId },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'RECORD_MERGE_IN_PROGRESS' });
    const [row] = await sql<Array<{ organization_id: string }>>(`select "organization_id" from "customer_accounts" where "id" = ?`, [id]);
    expect(row!.organization_id).toBe(ids.loserId);
  });

  it('moves a member with the mode move, and refuses the last administrator of a company', async () => {
    const ids = await insertOrganizationPair(h);
    const loserRoles = await roles(ids.loserId);
    const survivorRoles = await roles(ids.survivorId);
    const admin = await account(ids.loserId, loserRoles.administrator);
    const member = await account(ids.loserId, loserRoles.member);
    const moved = await withSystemScope('integration', () =>
      cradle().membershipPort.changeOrganization({ customerAccountId: member, organizationId: ids.survivorId, source: 'integration' }),
    );
    expect(moved).toMatchObject({ mode: 'move', changed: true, organizationRoleId: survivorRoles.member, toOrganizationId: ids.survivorId });
    await expect(
      withSystemScope('integration', () =>
        cradle().membershipPort.changeOrganization({ customerAccountId: admin, organizationId: ids.survivorId, source: 'integration' }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ORG_OWNER_DEPLETION' });
  });

  /**
   * `contracts/membership-merge-mode.md` §4 — a hook module that refuses one
   * member's move. The hook is registered and sealed in a command-hook
   * registry with `customer_accounts`' own hookable-action declaration, on a
   * Command Bus over the same ORM, audit log and event bus; for the length of
   * the test the composition's `commandBus` hands that bus the membership
   * Command (and only it), so the composed participant, driven by the
   * platform's runner, meets a real `beforeCommit` veto.
   */
  it('a registered beforeCommit veto rolls back that account only; the step retries, stops in needs_attention, and resumes (§4)', async () => {
    const ids = await insertOrganizationPair(h);
    const loserRoles = await roles(ids.loserId);
    const survivorRoles = await roles(ids.survivorId);
    // The step takes the loser's members in id order: the first moves, the second is vetoed, the third waits.
    const members = [
      await account(ids.loserId, loserRoles.administrator),
      await account(ids.loserId, loserRoles.member),
      await account(ids.loserId, loserRoles.member),
    ].sort();
    const [first, vetoed, third] = members as [string, string, string];
    await account(ids.survivorId, survivorRoles.administrator);

    let veto = true;
    const seen: Array<{ objectId: string; mode: string; mergeId: string | null }> = [];
    const hooks = sealedCommandHookRegistry({
      hookableActions: (customerAccountsManifest.hookableActions ?? []).map((declaration) => ({
        moduleId: 'customer_accounts',
        ...declaration,
      })),
      moduleDependencies: { [VETO_MODULE]: ['customer_accounts'] },
      hooks: [
        {
          moduleId: VETO_MODULE,
          entries: [
            {
              id: 'refuse-one-member',
              on: CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS.changeOrganization,
              phase: 'beforeCommit',
              handler: async (ctx) => {
                seen.push({ objectId: ctx.objectId, mode: ctx.data.mode, mergeId: ctx.data.mergeId });
                if (veto && ctx.objectId === vetoed) {
                  throw new CommandHookRefusal(409, VETO.MERGE_VETO_FIXTURE_REFUSED, 'This member may not follow the merge.');
                }
              },
            },
          ],
        },
      ],
    });
    const container = h.container as unknown as AwilixContainer<{ commandBus: CommandBus; auditLogService: AuditPort }>;
    const composed = container.cradle.commandBus;
    const hooked = new CommandBus(h.orm, container.cradle.auditLogService, h.eventBus, { hooks });
    const routed: Pick<CommandBus, 'run'> = {
      run: (command) => (command.action === CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS.changeOrganization.action ? hooked : composed).run(command),
    };
    const original = container.registrations['commandBus']!;
    container.register({ commandBus: asValue(routed) });
    const cookies = { b2b_session: 'stub-admin-session' };
    try {
      const start = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${ids.survivorId}/merges`,
        cookies,
        payload: { loserId: ids.loserId, acknowledgeIrreversible: true },
      });
      expect(start.statusCode, start.body).toBe(202);
      const mergeId: string = start.json().data.id;

      // Every batch meets the veto; the runner retries with backoff and then stops the merge.
      await h.recordMergeRuntime.run(mergeId);
      const stopped = await cradle().recordMergeService.get(mergeId);
      expect(stopped?.state).toBe('needs_attention');
      expect(stopped?.steps.find((step) => step.moduleId === 'customer_accounts')).toMatchObject({
        state: 'failed',
        lastErrorCode: VETO.MERGE_VETO_FIXTURE_REFUSED,
      });
      expect(seen.filter((call) => call.objectId === vetoed).length).toBeGreaterThan(1);
      expect(seen.every((call) => call.mode === 'merge' && call.mergeId === mergeId)).toBe(true);

      // The vetoed account only rolled back: the one before it committed, the one after it was never tried.
      const where = async () =>
        new Map(
          (
            await sql<Array<{ id: string; organization_id: string }>>(
              `select "id","organization_id" from "customer_accounts" where "id" = any(?::uuid[])`,
              [`{${members.join(',')}}`],
            )
          ).map((row) => [row.id, row.organization_id]),
        );
      expect(await where()).toEqual(
        new Map([
          [first, ids.survivorId],
          [vetoed, ids.loserId],
          [third, ids.loserId],
        ]),
      );
      const audited = await sql<Array<{ object_id: string }>>(
        `select "object_id" from "audit_log_entries" where "action" = 'customer_account.organization.change' and "state_after" ->> 'mergeId' = ?`,
        [mergeId],
      );
      expect(audited.map((row) => row.object_id)).toEqual([first]);

      // The hook stops objecting; a resume finishes the step and the merge.
      veto = false;
      const resume = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organization-merges/${mergeId}/resume`,
        cookies,
        payload: { expectedVersion: stopped!.version },
      });
      expect(resume.statusCode, resume.body).toBe(200);
      await h.recordMergeRuntime.run(mergeId);
      expect((await cradle().recordMergeService.get(mergeId))?.state).toBe('completed');
      expect([...(await where()).values()]).toEqual([ids.survivorId, ids.survivorId, ids.survivorId]);
    } finally {
      container.register({ commandBus: original });
    }
  }, 120_000);

  /**
   * A running merge between the pair, recorded through the platform's own
   * service (the host's start Command does the same after its preview), then
   * released, so the pair is not left frozen for the next test.
   */
  async function withRunningMerge<T>(
    ids: { survivorId: string; loserId: string },
    run: (mergeId: string) => Promise<T>,
  ): Promise<T> {
    const em = h.em().fork();
    const record = await em.transactional((tx) =>
      cradle().recordMergeService.begin(tx as never, {
        hostType: 'organization',
        survivorId: ids.survivorId,
        loserId: ids.loserId,
        fieldChoices: {},
        customFieldChoices: {},
        actor: { kind: 'system', actorAdminUserId: null, impersonatedCustomerAccountId: null },
        source: null,
      }),
    );
    return run(record.id);
  }
});
