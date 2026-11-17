import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import { resetReturnGraph } from './helpers.js';
import { complaintReasonId } from './off-platform-fixtures.js';
import {
  captureReturnsNotificationJobs,
  overrideReturnsSetting,
  processReturnsNotification,
  type CapturedReturnsJob,
} from './notification-jobs.js';
import { allowGuests, fileGuestCase, openGuestSession, trackingTokenOf } from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T027 (FR-045, FR-050 – FR-052; research R-7, R-10):
 * what a guest's filing sends.
 *
 * - The guest's confirmation is `return_guest_submitted`, to the verified address with
 *   the tracking link — sent even while the account confirmation is switched off.
 * - The shop's `return_new_case` names the guest as "{name} (guest)" and no organization.
 * - The bell tells only the administrators holding `returns:read` who reach every
 *   organization: never a sales representative.
 * - A verification alone sends nothing of the case's.
 */
describe('returns — the notifications of a guest’s complaint', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  let reasonId: string;
  let undo: () => Promise<void>;
  let reader: { adminUserId: string; undo: () => void };
  let representative: { adminUserId: string; undo: () => void };
  const jobs: CapturedReturnsJob[] = [];

  const mailsFor = (kind: string, id: string) =>
    mailer.sent.filter((m) => m.meta?.['kind'] === kind && m.meta?.['returnCaseId'] === id);
  const submittedJob = (id: string) => jobs.find((j) => j.kind === 'case_submitted' && j.returnCaseId === id)!;

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer, moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    undo = await allowGuests(h);
    reader = await seedCrmAdmin(h.em(), 'guest_returns_reader', ['returns:read']);
    representative = await seedCrmSalesRep(h.em(), [], ['returns:read']);
  });
  afterAll(async () => {
    reader.undo();
    representative.undo();
    await undo();
    await teardownBackendServer(h);
  });

  it('sends the guest confirmation with the tracking link, even with the account confirmation off (FR-045)', async () => {
    const knex = h.em().getKnex();
    await knex('transactional_emails').where({ code: 'return_submitted' }).update({ active: false });
    try {
      const filed = await fileGuestCase(h, reasonId);
      const report = (await processReturnsNotification(h, submittedJob(filed.caseId))) as {
        messages: Array<{ code: string; recipient: string; status: string }>;
      };
      const mails = mailsFor('return_guest_submitted', filed.caseId);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.to).toBe(filed.email);
      expect(mails[0]!.subject).toContain(filed.reference);
      expect(mails[0]!.text).toContain(`http://localhost:3000/returns/track/${trackingTokenOf(h, filed.caseId, 1)}`);
      expect(mailsFor('return_submitted', filed.caseId)).toHaveLength(0);
      expect(report.messages).toContainEqual({ code: 'return_guest_submitted', recipient: 'guest', status: 'sent' });
    } finally {
      await knex('transactional_emails').where({ code: 'return_submitted' }).update({ active: true });
    }
  });

  it('names the guest and no organization in the shop’s new-case e-mail (FR-050)', async () => {
    const restore = await overrideReturnsSetting(h, 'returns.new_case_recipients', ['shop@example.test']);
    try {
      const filed = await fileGuestCase(h, reasonId);
      await processReturnsNotification(h, submittedJob(filed.caseId));
      const shop = mailsFor('return_new_case', filed.caseId);
      expect(shop).toHaveLength(1);
      expect(shop[0]!.text).toContain('Gość Kowalski (guest)');
      expect(shop[0]!.text).toMatch(/Organization: *(\n|$)/);
      expect(shop[0]!.text).not.toContain(filed.email);
    } finally {
      await restore();
    }
  });

  it('tells only the unrestricted administrators holding returns:read, never a sales representative (FR-051)', async () => {
    const filed = await fileGuestCase(h, reasonId);
    await processReturnsNotification(h, submittedJob(filed.caseId));
    const entries = await h.em().fork().find(AdminNotification, { subjectId: filed.caseId }, { filters: false });
    const targets = entries.map((e) => e.targetAdminUserId);
    expect(targets).toContain(reader.adminUserId);
    expect(targets).not.toContain(representative.adminUserId);
  });

  it('sends nothing of a case on a verification alone', async () => {
    const before = jobs.filter((j) => j.kind === 'case_submitted').length;
    const session = await openGuestSession(h);
    expect(jobs.filter((j) => j.kind === 'case_submitted').length).toBe(before);
    expect(mailer.sent.filter((m) => m.to === session.email)).toEqual([]);
  });
});
