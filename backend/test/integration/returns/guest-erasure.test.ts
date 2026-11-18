import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { ReturnCase, ReturnCaseAttachment, ReturnCaseComment, ReturnCaseItem } from '../../helpers/package-entities.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  runReturnsMaintenanceJob,
  type ReturnsMaintenanceJobDeps,
} from '../../../../packages/modules/returns/src/backend/workers/returns-maintenance-worker.js';
import { ADMIN_COOKIE, resetReturnGraph } from './helpers.js';
import { complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';
import { captureReturnsNotificationJobs, overrideReturnsSetting, type CapturedReturnsJob } from './notification-jobs.js';
import { allowGuests, fileGuestCase, track, trackComment, verificationsOf, type FiledGuestCase } from './guest-fixtures.js';

const RETENTION_SETTING = 'returns.guest_data_retention_days';
const DAY_MS = 86_400_000;

/**
 * `specs/181-guest-complaints/` T054 (US4; FR-026, FR-070, FR-071, FR-073; research R-9):
 * the daily `returns-maintenance` sweep erases a guest's personal data once the case has
 * been closed for the retention period, and deletes verification rows after 7 days.
 *
 * - Due: contact and ship-back address nulled, every file's bytes and row deleted,
 *   `personal_data_erased_at` stamped; comments, lines, purchase data, clauses and the
 *   resolution kept; the tracking link refused.
 * - Not due: an open case, or one closed for less than the period.
 * - The setting is clamped to 30 – 3 650 days when read.
 * - One audit entry per case, `return_case.guest_data.erase` with trigger `retention`,
 *   counts and field names only.
 * - Idempotent; postponed while `returns` is off and caught up at the next sweep.
 */
describe('returns — erasing a guest’s personal data after the retention period', () => {
  let h: BackendServerHandle;
  let undoGuests: () => Promise<void>;
  let undoStore: () => Promise<void>;
  let baseDir: string;
  let reasonId: string;
  let deps: ReturnsMaintenanceJobDeps;
  const jobs: CapturedReturnsJob[] = [];

  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);
  const sweep = (now = new Date()) => runWithoutTenantContext(() => runReturnsMaintenanceJob(deps, now));
  const stored = (id: string) => h.em().fork().findOneOrFail(ReturnCase, { id }, { filters: false });
  const auditOf = (id: string) => h.em().fork().find(AuditLogEntry, { objectId: id, action: 'return_case.guest_data.erase' });

  beforeAll(async () => {
    h = await setupBackendServer({ moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    ({ undo: undoStore, baseDir } = await useTemporaryAssetStore(h));
    undoGuests = await allowGuests(h);
    reasonId = await complaintReasonId(h.em());
    deps = h.container.resolve('returnsMaintenanceDeps') as ReturnsMaintenanceJobDeps;
  });
  afterAll(async () => {
    await undoGuests();
    await undoStore();
    await teardownBackendServer(h);
  });

  /** A guest case with a file, a guest comment and a settled resolution, closed `daysAgo` days ago (`null` = open). */
  async function guestCase(daysAgo: number | null): Promise<FiledGuestCase & { locators: string[] }> {
    const filed = await fileGuestCase(h, reasonId);
    expect((await trackComment(h, filed.trackingToken, 'My phone is 600 000 181')).statusCode).toBe(201);
    if (daysAgo !== null) {
      await sql(
        `update "return_cases" set "status_code" = 'closed', "resolution_type" = 'settled_outside', "resolution_note" = 'Exchanged in the shop',
           "closed_at" = now() - (? || ' days')::interval where "id" = ?`,
        [String(daysAgo), filed.caseId],
      );
    }
    const files = await h.em().fork().find(ReturnCaseAttachment, { returnCaseId: filed.caseId }, { filters: false });
    const locators = files.map((f) => f.storageLocator!);
    expect(locators.length).toBe(1);
    for (const locator of locators) expect(existsSync(join(baseDir, locator))).toBe(true);
    return { ...filed, locators };
  }

  async function expectErased(c: FiledGuestCase & { locators: string[] }): Promise<void> {
    const rc = await stored(c.caseId);
    expect(rc.contact ?? null).toBeNull();
    expect(rc.returnAddress ?? null).toBeNull();
    expect(rc.personalDataErasedAt).toBeInstanceOf(Date);
    // Kept (G10): the lines, the purchase, the clauses, the comments and the resolution.
    expect(rc.purchaseDate).toBe('2026-10-01');
    expect(rc.purchaseProofNumber).toBe('FV/181/2026');
    expect(rc.resolutionType).toBe('settled_outside');
    expect(await h.em().fork().count(ReturnCaseItem, { returnCaseId: c.caseId })).toBe(1);
    expect(await h.em().fork().count(ReturnCaseComment, { returnCaseId: c.caseId })).toBe(1);
    // The files: the bytes and then the rows.
    expect(await h.em().fork().count(ReturnCaseAttachment, { returnCaseId: c.caseId }, { filters: false })).toBe(0);
    for (const locator of c.locators) expect(existsSync(join(baseDir, locator))).toBe(false);
    // The tracking link stops working.
    expect((await track(h, c.trackingToken)).statusCode).toBe(404);
  }

  async function expectUntouched(c: FiledGuestCase & { locators: string[] }): Promise<void> {
    const rc = await stored(c.caseId);
    expect(rc.personalDataErasedAt ?? null).toBeNull();
    expect(rc.contact?.email).toBe(c.email);
    expect(await h.em().fork().count(ReturnCaseAttachment, { returnCaseId: c.caseId }, { filters: false })).toBe(1);
    expect(await auditOf(c.caseId)).toEqual([]);
  }

  it('erases a case closed longer ago than the retention period, and keeps the rest of it', async () => {
    const due = await guestCase(91);
    await sweep();
    await expectErased(due);
  });

  it('leaves an open case and one closed for less than the period untouched', async () => {
    const open = await guestCase(null);
    const recent = await guestCase(89);
    await sweep();
    await expectUntouched(open);
    await expectUntouched(recent);
  });

  it('states on the detail when the link expires and when the data is due for erasure', async () => {
    const open = await guestCase(null);
    const closed = await guestCase(10);
    const detailOf = async (id: string) =>
      (
        (await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}`, cookies: ADMIN_COOKIE })).json() as {
          data: { guest: boolean; contactVerifiedAt: string | null; trackingLinkValidUntil: string | null; guestDataErasureDueAt: string | null };
        }
      ).data;
    const openDetail = await detailOf(open.caseId);
    expect(openDetail).toMatchObject({ guest: true, trackingLinkValidUntil: null, guestDataErasureDueAt: null });
    expect(openDetail.contactVerifiedAt).not.toBeNull();

    const closedAt = (await stored(closed.caseId)).closedAt!.getTime();
    const closedDetail = await detailOf(closed.caseId);
    expect(closedDetail.trackingLinkValidUntil).toBe(new Date(closedAt + 90 * DAY_MS).toISOString());
    expect(closedDetail.guestDataErasureDueAt).toBe(new Date(closedAt + 90 * DAY_MS).toISOString());

    const undo = await overrideReturnsSetting(h, RETENTION_SETTING, 10);
    try {
      expect((await detailOf(closed.caseId)).guestDataErasureDueAt).toBe(new Date(closedAt + 30 * DAY_MS).toISOString());
    } finally {
      await undo();
    }
    await sql(`update "return_cases" set "closed_at" = now() - interval '100 days' where "id" = ?`, [closed.caseId]);
    await sweep();
    expect(await detailOf(closed.caseId)).toMatchObject({ trackingLinkValidUntil: null, guestDataErasureDueAt: null });
  });

  it('reads a retention of 10 as 30 days and one of 9 999 as 3 650', async () => {
    const undoLow = await overrideReturnsSetting(h, RETENTION_SETTING, 10);
    try {
      const keep = await guestCase(20);
      const erase = await guestCase(31);
      await sweep();
      await expectUntouched(keep);
      await expectErased(erase);
    } finally {
      await undoLow();
    }
    const undoHigh = await overrideReturnsSetting(h, RETENTION_SETTING, 9999);
    try {
      const keep = await guestCase(3000);
      const erase = await guestCase(3651);
      await sweep();
      await expectUntouched(keep);
      await expectErased(erase);
    } finally {
      await undoHigh();
    }
  });

  it('audits each erasure once, with counts and field names only, and is idempotent', async () => {
    const due = await guestCase(120);
    await sweep();
    await sweep();
    const entries = await auditOf(due.caseId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.objectType).toBe('return_case');
    expect(entries[0]!.stateAfter).toEqual({ trigger: 'retention', attachmentCount: 1, fields: ['contact', 'returnAddress'] });
    expect(entries[0]!.actorAdminUserId ?? null).toBeNull();
    const text = JSON.stringify(entries);
    for (const value of [due.email, 'Gość', 'Prosta', '600 000 181', 'receipt.pdf']) expect(text).not.toContain(value);
    await expectErased(due);
  });

  it('deletes verification rows older than 7 days and keeps younger ones', async () => {
    const old = await fileGuestCase(h, reasonId);
    const young = await fileGuestCase(h, reasonId);
    await sql(`update "return_guest_verifications" set "created_at" = now() - interval '8 days' where "id" = ?`, [old.verificationId]);
    await sql(`update "return_guest_verifications" set "created_at" = now() - interval '6 days' where "id" = ?`, [young.verificationId]);
    await sweep();
    expect(await verificationsOf(h, old.email)).toEqual([]);
    expect((await verificationsOf(h, young.email)).map((v) => v.id)).toEqual([young.verificationId]);
    // The case keeps the session's id; nothing reads the session through it afterwards.
    expect((await stored(old.caseId)).guestSessionId).toBe(old.verificationId);
  });

  it('runs nothing while returns is off, and catches up at the next sweep once it is back', async () => {
    const due = await guestCase(200);
    const old = await fileGuestCase(h, reasonId);
    await sql(`update "return_guest_verifications" set "created_at" = now() - interval '9 days' where "id" = ?`, [old.verificationId]);
    await withModuleOff('returns', 'deactivated', async () => {
      await sweep();
    });
    expect((await stored(due.caseId)).personalDataErasedAt ?? null).toBeNull();
    expect(await verificationsOf(h, old.email)).toHaveLength(1);

    await sweep();
    await expectErased(due);
    expect(await verificationsOf(h, old.email)).toEqual([]);
  });

  it('never erases a customer’s case, whatever its age', async () => {
    const res = await file(h, noOrderBody(reasonId), { headers: { 'x-sales-channel': 'default' } });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    await sql(`update "return_cases" set "status_code" = 'closed', "closed_at" = now() - interval '4000 days' where "id" = ?`, [id]);
    await sweep();
    expect(await auditOf(id)).toEqual([]);
    expect((await stored(id)).contact?.email).toBe('ewa@example.test');
  });
});
