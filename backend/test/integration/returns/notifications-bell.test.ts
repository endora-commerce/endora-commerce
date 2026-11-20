import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import {
  captureReturnsNotificationJobs,
  processReturnsNotification,
  type CapturedReturnsJob,
} from './notification-jobs.js';

/**
 * `specs/180-off-platform-complaints/` T022 (FR-A03, FR-A04, research R-3): a new
 * case records one bell entry per active administrator holding `returns:read`, and
 * none for an administrator who cannot open returns. With `admin_notifications` off
 * the case and its e-mails still happen, and nothing is recorded.
 */
describe('returns — the new-case bell', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  const jobs: CapturedReturnsJob[] = [];
  let reader: { adminUserId: string; undo: () => void };
  let outsider: { adminUserId: string; undo: () => void };

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer, moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    reader = await seedCrmAdmin(h.em(), 'returns_reader', ['returns:read']);
    outsider = await seedCrmAdmin(h.em(), 'orders_only', ['orders:read']);
  });
  afterAll(async () => {
    reader.undo();
    outsider.undo();
    await teardownBackendServer(h);
  });

  async function fileAndProcess(): Promise<string> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    const job = jobs.find((j) => j.kind === 'case_submitted' && j.returnCaseId === id);
    expect(job).toBeTruthy();
    await processReturnsNotification(h, job!);
    return id;
  }

  const entriesAbout = (id: string) =>
    h.em().fork().find(AdminNotification, { subjectId: id }, { filters: false, orderBy: { createdAt: 'asc' } });

  it('tells each administrator holding returns:read, linking to the case, and nobody else', async () => {
    const id = await fileAndProcess();
    const entries = await entriesAbout(id);
    const targets = entries.map((e) => e.targetAdminUserId);
    expect(targets).toContain(reader.adminUserId);
    expect(targets).not.toContain(outsider.adminUserId);
    expect(new Set(targets).size).toBe(targets.length);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        audience: 'admin_user',
        kind: 'returns.case_submitted',
        subjectType: 'return_case',
        linkPath: `/returns/${id}`,
      });
      expect(entry.titleMessage).toMatchObject({ scope: 'returns', key: 'notifications.newCase.title.complaint' });
    }
  });

  it.each(['deactivated', 'platform-unavailable'] as const)(
    'with admin_notifications %s, files the case and sends the e-mails, recording no entry',
    async (axis) => {
      const id = await withModuleOff('admin_notifications', axis, fileAndProcess);
      expect(await entriesAbout(id)).toEqual([]);
      expect(mailer.sent.some((m) => m.meta?.['kind'] === 'return_submitted' && m.meta?.['returnCaseId'] === id)).toBe(true);
    },
  );
});
