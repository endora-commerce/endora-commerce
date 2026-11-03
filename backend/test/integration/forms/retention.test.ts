import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formDetailSchema, formRetentionImpactResponseSchema, type FormDetail } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
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

const DAY = 24 * 60 * 60 * 1000;
const AXES: readonly OffStateAxis[] = ['deactivated', 'platform-unavailable'];

/**
 * User Story 9 — per-form retention (`specs/170-forms-module/` FR-054, research R-20, T118).
 *
 * A form's retention period is live (A-2): `PUT /forms/:id/retention` sets it — refused 403
 * `FORM_SCOPE_REQUIRED` to an administrator confined to some organisations, since the deletion it
 * schedules crosses tenants by construction — and the `forms-maintenance` tick deletes the entries
 * submitted before `now − days`, notes by cascade, in batches of 500, each batch one
 * `forms.entries.retention_delete` audit row naming the form, the cutoff and the count. The form's
 * counter follows. `GET …/retention-impact` says beforehand how many a period would delete.
 *
 * The tick is driven through the composed job (the harness consumes no queue), outside any tenant
 * context, as the worker runs it. Assertions read only the rows this file wrote.
 */
describe('forms — retention (US9)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const created: string[] = [];
  let channelId: string;
  let orgA: string;
  type Session = { cookies: { b2b_session: string }; undo: () => void };
  let scoped: Session;
  let formsWriterOnly: Session;

  const tick = (now = new Date()): Promise<void> => {
    const deps = h.container.resolve('formsMaintenanceDeps') as FormsMaintenanceJobDeps;
    return runWithoutTenantContext(() => runFormsMaintenanceJob(deps, now));
  };

  function call(method: 'GET' | 'PUT', path: string, cookies: Record<string, string>, payload?: unknown): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url: `/api/v1/admin/forms${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function setRetention(form: { id: string; revision: number }, retentionDays: number | null): Promise<FormDetail> {
    const response = await call('PUT', `/${form.id}/retention`, FORMS_ADMIN, { expectedRevision: form.revision, retentionDays });
    expect(response.statusCode, response.body).toBe(200);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  async function newForm(label: string): Promise<PublishedForm> {
    const form = await publishEntriesForm(h, `Retention ${label} ${RUN}`);
    created.push(form.detail.id);
    return form;
  }

  const entryAt = (form: PublishedForm, daysAgo: number, extra: { status?: 'spam'; owner?: { customerAccountId: string; organizationId: string } } = {}) =>
    insertFormEntry(h, {
      form,
      salesChannelId: channelId,
      submittedAt: new Date(Date.now() - daysAgo * DAY),
      answers: { name: `retention-${RUN}` },
      ...extra,
    });

  async function noteCount(entryId: string): Promise<number> {
    return withSystemScope('forms retention test: count the notes of an entry', async () => {
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
    orgA = await seedCrmOrganization(h.em(), `forms-retention-${RUN}`);
    const all = ['forms:read', 'forms:write', 'forms:entries_read', 'forms:entries_write'];
    scoped = await seedCrmSalesRep(h.em(), [orgA], all);
    formsWriterOnly = await seedCrmAdmin(h.em(), 'forms-retention-writer', ['forms:read', 'forms:write', 'forms:entries_read']);
  }, 90_000);

  afterAll(async () => {
    scoped?.undo();
    formsWriterOnly?.undo();
    if (h) await deleteForms(h, created);
    await teardownBackendServer(h);
  });

  it('deletes the entries older than the period with their notes, keeps the newer, and moves the counter (US9-1)', async () => {
    const form = await newForm('basic');
    const old = await entryAt(form, 40);
    const oldSpam = await entryAt(form, 45, { status: 'spam' });
    const fresh = await entryAt(form, 5);
    const noted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/forms/entries/${old}/notes`,
      cookies: FORMS_ADMIN,
      payload: { body: 'Called back' },
    });
    expect(noted.statusCode, noted.body).toBe(201);
    expect(await noteCount(old)).toBe(1);
    expect(await acceptedEntryCount(h, form.detail.id)).toBe(2);

    const detail = await setRetention(form.detail, 30);
    expect(detail.retentionDays).toBe(30);
    await tick();

    expect(await readEntryRow(h, old)).toBeUndefined();
    expect(await readEntryRow(h, oldSpam)).toBeUndefined();
    expect(await noteCount(old)).toBe(0);
    expect(await readEntryRow(h, fresh)).toBeDefined();
    // Only the non-spam entry was counted.
    expect(await acceptedEntryCount(h, form.detail.id)).toBe(1);
  });

  it('writes one audit row per batch naming the form, the cutoff and the count — never an answer', async () => {
    const form = await newForm('audit');
    for (let i = 0; i < 3; i += 1) await entryAt(form, 20 + i);
    await setRetention(form.detail, 10);
    const before = Date.now();
    await tick();

    const rows = await auditRows(h, { action: 'forms.entries.retention_delete', objectId: form.detail.id });
    expect(rows).toHaveLength(1);
    const after = rows[0]!.stateAfter as { formId: string; cutoff: string; deleted: number };
    expect(after.formId).toBe(form.detail.id);
    expect(after.deleted).toBe(3);
    const cutoff = Date.parse(after.cutoff);
    expect(Math.abs(cutoff - (before - 10 * DAY))).toBeLessThan(60_000);
    expect(JSON.stringify(rows[0])).not.toContain(`retention-${RUN}`);

    // An idle tick writes no further row.
    await tick();
    expect(await auditRows(h, { action: 'forms.entries.retention_delete', objectId: form.detail.id })).toHaveLength(1);
  });

  it('keeps everything when the form has no retention period (US9-2)', async () => {
    const form = await newForm('keep');
    const ancient = await entryAt(form, 3000);
    await tick();
    expect(await readEntryRow(h, ancient)).toBeDefined();

    // Setting a period and clearing it again before a tick keeps it too.
    const set = await setRetention(form.detail, 1);
    const cleared = await setRetention(set, null);
    expect(cleared.retentionDays).toBeNull();
    await tick();
    expect(await readEntryRow(h, ancient)).toBeDefined();
  });

  it.each(AXES)('deletes nothing while Forms is off (%s) and the next tick after its return deletes (US9-3)', async (axis) => {
    const form = await newForm(`off-${axis}`);
    const old = await entryAt(form, 400);
    await setRetention(form.detail, 365);

    await withModuleOff('forms', axis, async () => {
      await tick();
      expect(await readEntryRow(h, old)).toBeDefined();
    });
    expect(await readEntryRow(h, old)).toBeDefined();

    await tick();
    expect(await readEntryRow(h, old)).toBeUndefined();
  });

  it('answers beforehand how many entries a period would delete (edge case)', async () => {
    const form = await newForm('impact');
    await entryAt(form, 100);
    await entryAt(form, 50);
    await entryAt(form, 2);

    const impact = async (days: number) => {
      const response = await call('GET', `/${form.detail.id}/retention-impact?days=${days}`, FORMS_ADMIN);
      expect(response.statusCode, response.body).toBe(200);
      return formRetentionImpactResponseSchema.parse((response.json() as { data: unknown }).data).entriesToDelete;
    };
    expect(await impact(30)).toBe(2);
    expect(await impact(60)).toBe(1);
    expect(await impact(365)).toBe(0);

    const bad = await call('GET', `/${form.detail.id}/retention-impact?days=0`, FORMS_ADMIN);
    expect(bad.statusCode).toBe(400);
    const missing = await call('GET', `/00000000-0000-4000-8000-0000000170e9/retention-impact?days=30`, FORMS_ADMIN);
    expect(missing.statusCode).toBe(404);
  });

  it('refuses a scoped administrator with 403 FORM_SCOPE_REQUIRED and changes nothing', async () => {
    const form = await newForm('scoped');
    await entryAt(form, 10, { owner: { customerAccountId: randomUUID(), organizationId: orgA } });
    const response = await call('PUT', `/${form.detail.id}/retention`, scoped.cookies, {
      expectedRevision: form.detail.revision,
      retentionDays: 1,
    });
    expect(response.statusCode, response.body).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('FORM_SCOPE_REQUIRED');
    const read = await call('GET', `/${form.detail.id}`, FORMS_ADMIN);
    expect(formDetailSchema.parse((read.json() as { data: unknown }).data).retentionDays).toBeNull();
  });

  it('needs forms:entries_write as well as forms:write', async () => {
    const form = await newForm('perm');
    const response = await call('PUT', `/${form.detail.id}/retention`, formsWriterOnly.cookies, {
      expectedRevision: form.detail.revision,
      retentionDays: 1,
    });
    expect(response.statusCode, response.body).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).not.toBe('FORM_SCOPE_REQUIRED');
  });

  it('refuses a stale revision with 409 FORM_REVISION_CONFLICT and records the change it makes', async () => {
    const form = await newForm('revision');
    const updated = await setRetention(form.detail, 90);
    expect(updated.revision).toBeGreaterThan(form.detail.revision);
    const stale = await call('PUT', `/${form.detail.id}/retention`, FORMS_ADMIN, {
      expectedRevision: form.detail.revision,
      retentionDays: 30,
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect((stale.json() as { error: { code: string } }).error.code).toBe('FORM_REVISION_CONFLICT');
    const audit = await auditRows(h, { action: 'forms.form.retention_update', objectId: form.detail.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ stateBefore: { retentionDays: null }, stateAfter: { retentionDays: 90 } });
  });

  it('repairs a counter that drifted from the entries it counts', async () => {
    const form = await newForm('counter');
    await entryAt(form, 1);
    await entryAt(form, 1, { status: 'spam' });
    await withSystemScope('forms retention test: make the counter drift', async () => {
      await h.em().getConnection().execute(`update "forms" set "accepted_entry_count" = 7 where "id" = ?`, [form.detail.id]);
    });
    await tick();
    expect(await acceptedEntryCount(h, form.detail.id)).toBe(1);
  });
});
