import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type OrganizationDetailsPort, type RecordMergeRecord } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { RecordMergeRuntime } from '@endora-commerce/platform/composition';
import type { RecordMergeService, SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { makeMergeStartCommand } from '../../../../packages/modules/organizations/src/backend/commands/merge-start.command.js';
// The class the ORM registered from the package's `entities` array, not a second copy from source.
import { OrganizationInvitation } from '../../helpers/package-entities.js';

/**
 * `specs/192-organization-merge/` — the Organization host over a real database
 * (T026 – T031, FR-002 – FR-012, FR-020 – FR-033, FR-041 – FR-042, FR-050 –
 * FR-054, FR-060; SC-004, SC-005).
 *
 * Stage 1 ships the framework and the host and no other participant, so on a
 * full composition every module still holding an undeclared Organization
 * reference refuses a start with `RECORD_MERGE_PARTICIPATION_INCOMPLETE` — the
 * runtime twin of `check:merge-participation`. That is asserted over the
 * routes. The host's own phases are then driven through the platform's
 * runner: the merge is recorded with the start Command directly (the step the
 * route takes after the preview), so the structure and finalize phases, the
 * archive, the event, the identity rules and the freeze are proven over the
 * tables they write.
 */
describe('Organization merge — the organizations host', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const admin: TenantContext = { mode: 'all', actor: { kind: 'admin', id: TEST_ADMIN_ID } };
  const cookies = { b2b_session: 'stub-admin-session' };

  const cradle = () =>
    h.container.cradle as unknown as {
      commandBus: { run<T>(command: Command<T>): Promise<T> };
      recordMergeService: RecordMergeService;
      organizationDetailsPort: OrganizationDetailsPort;
      salesChannelMembershipPort: SalesChannelMembershipPort;
    };

  async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T> {
    return h.em().fork().getConnection().execute(statement, params) as Promise<T>;
  }

  const taxId = (): string => `MG${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;

  async function company(
    options: { name?: string; parentId?: string; personal?: boolean; custom?: Record<string, unknown>; emails?: string[] } = {},
  ): Promise<{ id: string; taxId: string | null }> {
    const id = randomUUID();
    const tax = options.personal ? null : taxId();
    let path = `/${id}/`;
    if (options.parentId) {
      const [parent] = await sql<Array<{ path: string }>>('select "path" from "organizations" where "id" = ?', [options.parentId]);
      path = `${parent!.path}${id}/`;
    }
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","parent_id",
          "custom_field_values","order_confirmation_emails","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', ?, ?, '{"street":"ul. Prosta 1","city":"Łódź","postalCode":"90-001","country":"PL"}'::jsonb,
               ?, ?, ?::jsonb, ?::jsonb, now(), now())`,
      [
        id,
        options.name ?? `Merge Co ${id.slice(0, 6)}`,
        tax,
        options.personal === true,
        options.personal ? randomUUID() : null,
        path,
        options.parentId ?? null,
        JSON.stringify(options.custom ?? {}),
        JSON.stringify(options.emails ?? []),
      ],
    );
    return { id, taxId: tax };
  }

  const previewRoute = (survivorId: string, loserId: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${survivorId}/merge-preview`,
      cookies,
      payload: { loserId },
    });

  const startRoute = (survivorId: string, payload: object) =>
    h.app.inject({ method: 'POST', url: `/api/v1/admin/organizations/${survivorId}/merges`, cookies, payload });

  /** Record a merge the way the start route does after its preview, bypassing the completeness refusal. */
  async function begin(
    survivorId: string,
    loserId: string,
    fieldChoices: Record<string, 'survivor' | 'loser'> = {},
  ): Promise<RecordMergeRecord> {
    const record = await runWithTenantContext(admin, () =>
      cradle().commandBus.run(
        makeMergeStartCommand(
          { recordMerge: () => cradle().recordMergeService },
          {
            mergeId: randomUUID(),
            survivorId,
            loserId,
            fieldChoices,
            customFieldChoices: {},
            source: null,
            participantCounts: {},
          },
        ),
      ),
    );
    await cradle().recordMergeService.announce(record.id);
    return record;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const [channel] = await sql<Array<{ id: string }>>(
      `select "id" from "sales_channels" where "system_default" = true limit 1`,
    );
    channelId = channel!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('the preview and the start over the admin routes', () => {
    it('answers the value differences, the host counts and the incomplete modules, writing nothing (FR-002)', async () => {
      const survivor = await company({ name: 'Acme' });
      const loser = await company({ name: 'ACME Ltd' });
      const before = await sql<Array<{ count: string }>>('select count(*)::text as "count" from "record_merges"');
      const res = await previewRoute(survivor.id, loser.id);
      expect(res.statusCode, res.body).toBe(200);
      const preview = res.json().data;
      expect(preview.fields.map((field: { code: string }) => field.code)).toEqual(expect.arrayContaining(['name', 'taxId']));
      expect(preview.participants.find((p: { moduleId: string }) => p.moduleId === 'organizations')).toBeDefined();
      // Stage 1: every module still holding an undeclared Organization reference.
      expect(preview.incomplete).toEqual(expect.arrayContaining(['orders', 'carts', 'customer_accounts']));
      expect(preview.refusals.map((r: { code: string }) => r.code)).toContain('RECORD_MERGE_PARTICIPATION_INCOMPLETE');
      const after = await sql<Array<{ count: string }>>('select count(*)::text as "count" from "record_merges"');
      expect(after[0]!.count).toBe(before[0]!.count);
    });

    it('refuses a start with the same answer as the preview, writing nothing (FR-003, SC-005)', async () => {
      const survivor = await company();
      const loser = await company();
      const res = await startRoute(survivor.id, { loserId: loser.id, acknowledgeIrreversible: true });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().error.code).toBe(ERROR_CODES.RECORD_MERGE_PARTICIPATION_INCOMPLETE);
      const rows = await sql<unknown[]>('select 1 from "record_merges" where "loser_id" = ?', [loser.id]);
      expect(rows).toEqual([]);
    });

    it('refuses a start without the irreversible acknowledgement (FR-012)', async () => {
      const survivor = await company();
      const loser = await company();
      const res = await startRoute(survivor.id, { loserId: loser.id });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json().error.code).toBe(ERROR_CODES.RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED);
    });

    it.each([
      ['a personal loser', async () => [await company(), await company({ personal: true })] as const, 'ORGANIZATION_MERGE_PERSONAL'],
      [
        'a loser above the survivor',
        async () => {
          const loser = await company();
          return [await company({ parentId: loser.id }), loser] as const;
        },
        'ORGANIZATION_MERGE_TREE_INVALID',
      ],
      [
        'non-roots of two trees',
        async () => {
          const a = await company();
          const b = await company();
          return [await company({ parentId: a.id }), await company({ parentId: b.id })] as const;
        },
        'ORGANIZATION_MERGE_TREE_INVALID',
      ],
    ])('previews and refuses %s identically (FR-021 – FR-023)', async (_label, make, code) => {
      const [survivor, loser] = await make();
      const preview = (await previewRoute(survivor.id, loser.id)).json().data;
      expect(preview.refusals.map((r: { code: string }) => r.code)).toContain(code);
      const start = await startRoute(survivor.id, { loserId: loser.id, acknowledgeIrreversible: true });
      expect(start.statusCode).toBe(409);
      expect(start.json().error.details.refusals).toContain(code);
    });

    it('answers 404 for a loser that does not exist, as for one out of reach (FR-025)', async () => {
      const survivor = await company();
      const res = await previewRoute(survivor.id, randomUUID());
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('refuses a merge into itself (FR-020)', async () => {
      const one = await company();
      const res = await startRoute(one.id, { loserId: one.id, acknowledgeIrreversible: true });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json().error.code).toBe(ERROR_CODES.RECORD_MERGE_SAME_RECORD);
    });
  });

  describe('a merge run by the platform runner through the host’s own phases', () => {
    let survivor: { id: string; taxId: string | null };
    let loser: { id: string; taxId: string | null };
    let child: { id: string };
    let merge: RecordMergeRecord;
    let customRoleId: string;
    let invitationId: string;
    const events: unknown[] = [];

    beforeAll(async () => {
      survivor = await company({ name: 'Survivor Co', custom: { tier: 'gold' }, emails: ['a@example.test'] });
      loser = await company({ name: 'Loser Co', custom: { tier: 'silver', region: 'north' }, emails: ['b@example.test', 'A@example.test'] });
      child = await company({ parentId: loser.id });
      customRoleId = randomUUID();
      await sql(
        `insert into "organization_roles" ("id","organization_id","kind","name","name_normalized","permissions","member_defaults_offered","version","created_at","updated_at")
         values (?, ?, 'custom', 'Buyer', 'buyer', '{}', '{}', 1, now(), now())`,
        [customRoleId, loser.id],
      );
      invitationId = randomUUID();
      await sql(
        `insert into "organization_invitations" ("id","organization_id","email","organization_role_id","token_hash","expires_at","created_at","updated_at")
         values (?, ?, 'invitee@example.test', ?, ?, now() + interval '7 days', now(), now())`,
        [invitationId, loser.id, customRoleId, randomUUID()],
      );
      await sql(
        `insert into "organization_sales_rep_assignments" ("id","organization_id","admin_user_id","created_at") values (?, ?, ?, now())`,
        [randomUUID(), loser.id, TEST_ADMIN_ID],
      );
      await sql(`delete from "sales_channel_organizations" where "organization_id" in (?, ?)`, [survivor.id, loser.id]);
      await sql(`insert into "sales_channel_organizations" ("sales_channel_id","organization_id") values (?, ?)`, [channelId, loser.id]);
      h.eventBus.on('organization.merged.v1' as never, (payload: unknown) => {
        events.push(payload);
      });

      merge = await begin(survivor.id, loser.id, { name: 'loser', taxId: 'loser' });
      expect(merge.state).toBe('running');
      // The host's own step, plus one per composed participant (MR-C / MR-D add
      // them; each proves its own step in its own test).
      const composed = (h.container.cradle as unknown as { recordMergeRuntime: RecordMergeRuntime }).recordMergeRuntime.registry
        .participantsOf('organization')
        .map((participant) => `${participant.moduleId}/${participant.key}`);
      expect(merge.steps.map((step) => `${step.moduleId}/${step.key}`).sort()).toEqual(
        ['organizations/host-structure', ...composed].sort(),
      );
    });

    it('freezes the loser while the merge runs: a write naming it is refused, the survivor stays writable (R-6)', async () => {
      const write = (organizationId: string) =>
        runWithTenantContext(admin, async () => {
          const em = h.em().fork();
          em.persist(
            em.create(OrganizationInvitation, {
              organizationId,
              email: `frozen-${randomUUID()}@example.test`,
              organizationRoleId: customRoleId,
              tokenHash: randomUUID(),
              expiresAt: new Date(Date.now() + 86_400_000),
            }),
          );
          await em.flush();
        });
      await expect(write(loser.id)).rejects.toMatchObject({ statusCode: 409, code: 'RECORD_MERGE_IN_PROGRESS' });
      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${loser.id}`,
        cookies,
        payload: { name: 'Renamed while merging' },
      });
      expect(patch.statusCode, patch.body).toBe(409);
      expect(patch.json().error.code).toBe('RECORD_MERGE_IN_PROGRESS');
    });

    it('refuses a second merge over either record while this one runs (data-model §1.3)', async () => {
      const other = await company();
      await expect(begin(survivor.id, other.id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'RECORD_MERGE_ALREADY_RUNNING',
      });
    });

    it('runs the structure and finalize phases and completes', async () => {
      const outcome = await h.recordMergeRuntime.run(merge.id);
      expect(outcome).toBe('completed');
      const record = await cradle().recordMergeService.get(merge.id);
      expect(record?.state).toBe('completed');
      expect(record?.steps[0]).toMatchObject({ state: 'done' });
    });

    it('moves the loser’s children under the survivor (FR-042)', async () => {
      const [row] = await sql<Array<{ parent_id: string; path: string }>>(
        'select "parent_id", "path" from "organizations" where "id" = ?',
        [child.id],
      );
      expect(row).toEqual({ parent_id: survivor.id, path: `/${survivor.id}/${child.id}/` });
    });

    it('copies the missing custom role, maps the invitation to it, and unions sales reps and channels (FR-041, FR-042)', async () => {
      const [role] = await sql<Array<{ id: string }>>(
        `select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'custom' and "name_normalized" = 'buyer'`,
        [survivor.id],
      );
      expect(role).toBeDefined();
      const [invitation] = await sql<Array<{ organization_id: string; organization_role_id: string }>>(
        'select "organization_id", "organization_role_id" from "organization_invitations" where "id" = ?',
        [invitationId],
      );
      expect(invitation).toEqual({ organization_id: survivor.id, organization_role_id: role!.id });
      const reps = await sql<Array<{ organization_id: string }>>(
        'select "organization_id" from "organization_sales_rep_assignments" where "admin_user_id" = ? and "organization_id" in (?, ?)',
        [TEST_ADMIN_ID, survivor.id, loser.id],
      );
      expect(reps).toEqual([{ organization_id: survivor.id }]);
      const channels = await sql<unknown[]>(
        'select 1 from "sales_channel_organizations" where "organization_id" = ? and "sales_channel_id" = ?',
        [survivor.id, channelId],
      );
      expect(channels).toHaveLength(1);
    });

    it('applies the chosen values, the e-mail union and the filled custom fields, and takes the loser’s tax ID (FR-030 – FR-033)', async () => {
      const [row] = await sql<
        Array<{ name: string; tax_id: string; order_confirmation_emails: string[]; custom_field_values: Record<string, unknown> }>
      >('select "name", "tax_id", "order_confirmation_emails", "custom_field_values" from "organizations" where "id" = ?', [survivor.id]);
      expect(row!.name).toBe('Loser Co');
      expect(row!.tax_id).toBe(loser.taxId);
      expect(row!.order_confirmation_emails).toEqual(['a@example.test', 'b@example.test']);
      // The survivor keeps its own value; the loser's extra key reaches the
      // definitions' validation (FR-031), which drops a key no definition
      // declares — none is defined in this composition. The fill-gaps rule
      // itself is `organization-merge-rules.test.ts`'.
      expect(row!.custom_field_values).toEqual({ tier: 'gold' });
    });

    it('archives the loser with its pointer, releasing the tax ID it gave away (FR-051, R-7, R-14a)', async () => {
      const [row] = await sql<
        Array<{ deleted_at: Date | null; merged_into_organization_id: string; merge_id: string; tax_id: string | null }>
      >('select "deleted_at", "merged_into_organization_id", "merge_id", "tax_id" from "organizations" where "id" = ?', [loser.id]);
      expect(row!.deleted_at).not.toBeNull();
      expect(row!.merged_into_organization_id).toBe(survivor.id);
      expect(row!.merge_id).toBe(merge.id);
      expect(row!.tax_id).toBeNull();
    });

    it('publishes organization.merged.v1 exactly once, with ids only, and never again on a re-run (FR-054)', async () => {
      expect(events).toEqual([
        expect.objectContaining({ organizationId: survivor.id, mergedOrganizationId: loser.id, mergeId: merge.id }),
      ]);
      await h.recordMergeRuntime.run(merge.id);
      expect(events).toHaveLength(1);
    });

    it('records the merge id in every audit entry it wrote, and no value (FR-060, SC-004)', async () => {
      const entries = await sql<Array<{ action: string; state_after: Record<string, unknown> }>>(
        `select "action", "state_after" from "audit_log_entries" where "state_after" ->> 'mergeId' = ? order by "acted_at"`,
        [merge.id],
      );
      expect(entries.map((entry) => entry.action)).toEqual([
        'organization.merge.start',
        'organization.merge.structure',
        'organization.merge.finalize',
      ]);
      expectNoAuditValues(
        entries.map((entry) => ({ action: entry.action, stateAfter: entry.state_after })),
        ['Loser Co', 'Survivor Co', 'silver', loser.taxId!],
      );
      expect(entries[2]!.state_after['changedFields']).toEqual(expect.arrayContaining(['name', 'taxId', 'orderConfirmationEmails']));
    });

    it('answers the archived loser by id with its survivor, and refuses a write naming it with ORGANIZATION_MERGED (FR-052, FR-053)', async () => {
      const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${loser.id}`, cookies });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().data).toMatchObject({ id: loser.id, mergedIntoOrganizationId: survivor.id, mergeId: merge.id });
      const write = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${loser.id}`,
        cookies,
        payload: { name: 'Too late' },
      });
      expect(write.statusCode, write.body).toBe(409);
      expect(write.json().error).toMatchObject({ code: 'ORGANIZATION_MERGED', details: { survivorId: survivor.id } });
      expect(await cradle().organizationDetailsPort.resolveMerged(loser.id)).toBe(survivor.id);
      expect(await cradle().organizationDetailsPort.resolveMerged(survivor.id)).toBe(survivor.id);
      expect((await cradle().organizationDetailsPort.findById(loser.id))?.mergedIntoOrganizationId).toBe(survivor.id);
    });

    it('serves the merge and its steps, and refuses to cancel or resume a completed merge (FR-011)', async () => {
      const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organization-merges/${merge.id}`, cookies });
      expect(read.statusCode, read.body).toBe(200);
      const record = read.json().data;
      expect(record).toMatchObject({ id: merge.id, state: 'completed', fieldChoices: { name: 'loser', taxId: 'loser' } });
      const cancel = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organization-merges/${merge.id}/cancel`,
        cookies,
        payload: { expectedVersion: record.version },
      });
      expect(cancel.json().error.code).toBe('RECORD_MERGE_NOT_CANCELLABLE');
      const resume = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organization-merges/${merge.id}/resume`,
        cookies,
        payload: { expectedVersion: record.version },
      });
      expect(resume.json().error.code).toBe('RECORD_MERGE_NOT_RESUMABLE');
      const list = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organization-merges?organizationId=${survivor.id}`, cookies });
      expect(list.json().data.map((m: { id: string }) => m.id)).toContain(merge.id);
    });
  });

  describe('cancel', () => {
    it('cancels a merge no step has started, releasing the locks and the freeze (FR-011)', async () => {
      const survivor = await company();
      const loser = await company();
      const merge = await begin(survivor.id, loser.id);
      const cancel = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organization-merges/${merge.id}/cancel`,
        cookies,
        payload: { expectedVersion: merge.version },
      });
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect(cancel.json().data.state).toBe('cancelled');
      const locks = await sql<unknown[]>('select 1 from "record_merge_locks" where "merge_id" = ?', [merge.id]);
      expect(locks).toEqual([]);
      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${loser.id}`,
        cookies,
        payload: { name: 'Writable again' },
      });
      expect(patch.statusCode, patch.body).toBe(200);
      // A cancelled merge is not run.
      expect(await h.recordMergeRuntime.run(merge.id)).toBe('idle');
    });

    it('refuses a stale version', async () => {
      const merge = await begin((await company()).id, (await company()).id);
      const cancel = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organization-merges/${merge.id}/cancel`,
        cookies,
        payload: { expectedVersion: merge.version + 5 },
      });
      expect(cancel.statusCode).toBe(409);
      expect(cancel.json().error.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('racing starts (T016)', () => {
    it('admits exactly one of two starts over overlapping records', async () => {
      const shared = await company();
      const a = await company();
      const b = await company();
      const results = await Promise.allSettled([begin(shared.id, a.id), begin(shared.id, b.id)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(refused?.reason).toMatchObject({ code: 'RECORD_MERGE_ALREADY_RUNNING' });
    });
  });
});
