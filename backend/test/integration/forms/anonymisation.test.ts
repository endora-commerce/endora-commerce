import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { seedCrmOrganization } from '../../helpers/seed-crm.js';
import {
  FORMS_ADMIN,
  acceptedEntryCount,
  auditRows,
  deleteForms,
  insertFormEntry,
  publishEntriesForm,
  readEntryRow,
  type PublishedForm,
} from '../../helpers/seed-forms.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  runFormsMaintenanceJob,
  type FormsMaintenanceJobDeps,
} from '../../../../packages/modules/forms/src/backend/workers/forms-maintenance-worker.js';

const AXES: readonly OffStateAxis[] = ['deactivated', 'platform-unavailable'];
const YEAR = 365 * 24 * 60 * 60 * 1000;

interface SweepHandle {
  handle(): { anonymizationSweepWorker: { sweep(now?: Date): Promise<number> } };
}

/**
 * FR-047 — an anonymised customer account's entries are erased (`specs/170-forms-module/` research
 * R-17, contracts/events-and-webhook.md §3, T120; OQ-1: at **anonymisation**, never at the
 * reversible soft delete).
 *
 * The `customers` retention sweep anonymises an account; `customer_accounts` announces it with
 * `customer_account.anonymized.v1` in a bus scope the sweep awaits; `forms` erases the account's
 * attributed entries and their notes within that step. Entries are matched by attribution only —
 * an anonymous entry carrying the same e-mail is **not** touched (documented for the operator).
 * While `forms` is off its subscriber misses the event, so the maintenance tick reconciles: every
 * attributed account that is anonymised, or that no longer resolves, loses its entries on the first
 * tick after the module is back.
 *
 * The sweep is the composed one, driven in the system scope the way a scheduler would run it.
 */
describe('forms — erasure of an anonymised customer account (FR-047)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const created: string[] = [];
  const accounts: string[] = [];
  let channelId: string;
  let organizationId: string;
  let form: PublishedForm;

  const sweep = (): Promise<number> =>
    withSystemScope('forms anonymisation test: run the customers retention sweep', () =>
      (h.container.resolve('customers') as SweepHandle).handle().anonymizationSweepWorker.sweep(new Date()),
    );

  const tick = (): Promise<void> => {
    const deps = h.container.resolve('formsMaintenanceDeps') as FormsMaintenanceJobDeps;
    return runWithoutTenantContext(() => runFormsMaintenanceJob(deps, new Date()));
  };

  /** A customer account, soft-deleted long enough ago for the sweep to anonymise it when `due`. */
  async function account(label: string, due: boolean): Promise<{ id: string; email: string }> {
    const email = `${label}-${RUN}@forms-erasure.test`;
    const em = h.em().fork();
    const row = em.create(CustomerAccount, {
      organizationId,
      email,
      passwordHash: 'x'.repeat(60),
      firstName: 'Erasure',
      lastName: label,
      role: 'regular_user',
      emailVerifiedAt: new Date(),
      deletedAt: due ? new Date(Date.now() - 3 * YEAR) : null,
    } as never);
    await em.persistAndFlush(row);
    accounts.push(row.id);
    return { id: row.id, email };
  }

  async function softDelete(id: string): Promise<void> {
    await h
      .em()
      .getConnection()
      .execute(`update "customer_accounts" set "deleted_at" = ? where "id" = ?`, [new Date(Date.now() - 3 * YEAR), id]);
  }

  const entryOf = (owner: string | null, email: string) =>
    insertFormEntry(h, {
      form,
      salesChannelId: channelId,
      submittedAt: new Date(),
      answers: { name: `erasure-${RUN}` },
      submitterEmail: email,
      owner: owner === null ? null : { customerAccountId: owner, organizationId },
    });

  async function noteCount(entryId: string): Promise<number> {
    return withSystemScope('forms anonymisation test: count the notes of an entry', async () => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select count(*)::int as "n" from "form_entry_notes" where "entry_id" = ?`, [entryId])) as Array<{ n: number }>;
      return rows[0]!.n;
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = (await h.em().fork().findOneOrFail(SalesChannel, { code: 'default' })).id;
    organizationId = await seedCrmOrganization(h.em(), `forms-erasure-${RUN}`);
    form = await publishEntriesForm(h, `Erasure ${RUN}`);
    created.push(form.detail.id);
  }, 90_000);

  afterAll(async () => {
    if (h) {
      await deleteForms(h, created);
      if (accounts.length > 0) {
        await h
          .em()
          .getConnection()
          .execute(`delete from "customer_accounts" where "id" = any(?::uuid[])`, [`{${accounts.join(',')}}`]);
      }
    }
    await teardownBackendServer(h);
  });

  it('erases the anonymised account’s entries and notes in the same sweep; anonymous ones with its e-mail and another account’s stay', async () => {
    const doomed = await account('doomed', true);
    const other = await account('other', false);
    const attributed = await entryOf(doomed.id, doomed.email);
    const secondAttributed = await entryOf(doomed.id, 'someone-else@forms-erasure.test');
    const anonymousSameEmail = await entryOf(null, doomed.email);
    const othersEntry = await entryOf(other.id, other.email);
    const noted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/forms/entries/${attributed}/notes`,
      cookies: FORMS_ADMIN,
      payload: { body: 'Called back' },
    });
    expect(noted.statusCode, noted.body).toBe(201);
    const countBefore = await acceptedEntryCount(h, form.detail.id);

    expect(await sweep()).toBeGreaterThanOrEqual(1);

    expect(await readEntryRow(h, attributed)).toBeUndefined();
    expect(await readEntryRow(h, secondAttributed)).toBeUndefined();
    expect(await noteCount(attributed)).toBe(0);
    expect(await readEntryRow(h, anonymousSameEmail)).toBeDefined();
    expect(await readEntryRow(h, othersEntry)).toBeDefined();
    expect(await acceptedEntryCount(h, form.detail.id)).toBe(countBefore - 2);

    const audit = await auditRows(h, { action: 'forms.entries.erase_for_account', objectId: doomed.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.stateAfter).toMatchObject({ deleted: 2 });
    expect(JSON.stringify(audit[0])).not.toContain(doomed.email);
  });

  it('keeps the entries of an account that is only soft-deleted (OQ-1: restorable, so not erased)', async () => {
    const pending = await account('pending', false);
    await h
      .em()
      .getConnection()
      .execute(`update "customer_accounts" set "deleted_at" = now() where "id" = ?`, [pending.id]);
    const kept = await entryOf(pending.id, pending.email);
    await sweep();
    await tick();
    expect(await readEntryRow(h, kept)).toBeDefined();
  });

  it.each(AXES)(
    'with Forms off (%s) the entries stay through the sweep; the first tick after its return erases them',
    async (axis) => {
      const missed = await account(`missed-${axis}`, false);
      const entry = await entryOf(missed.id, missed.email);
      await softDelete(missed.id);

      await withModuleOff('forms', axis, async () => {
        expect(await sweep()).toBeGreaterThanOrEqual(1);
        await tick();
        expect(await readEntryRow(h, entry)).toBeDefined();
      });
      const anonymised = (await h
        .em()
        .getConnection()
        .execute(`select "anonymized_at" from "customer_accounts" where "id" = ?`, [missed.id])) as Array<{
        anonymized_at: Date | null;
      }>;
      expect(anonymised[0]!.anonymized_at).not.toBeNull();
      expect(await readEntryRow(h, entry)).toBeDefined();

      await tick();
      expect(await readEntryRow(h, entry)).toBeUndefined();
    },
  );

  it('reconciles the entries of an account that no longer resolves', async () => {
    const vanished = randomUUID();
    const entry = await entryOf(vanished, `vanished-${RUN}@forms-erasure.test`);
    const live = await account('live', false);
    const liveEntry = await entryOf(live.id, live.email);

    await tick();

    expect(await readEntryRow(h, entry)).toBeUndefined();
    expect(await readEntryRow(h, liveEntry)).toBeDefined();
  });
});
