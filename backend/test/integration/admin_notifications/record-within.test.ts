import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminNotificationRecordPort,
  RecordAdminNotificationInput,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminNotification } from '../../helpers/package-entities.js';

/**
 * The co-transactional half of the record port, `recordWithin(em, input)`
 * (`specs/165-task-management/contracts/foreign-module-changes.md` §E2).
 *
 * `record(input)` writes on an EntityManager of its own and commits on its own,
 * so a caller cannot make a bell entry and a row of its own commit together.
 * `recordWithin` writes on the **caller's** EntityManager, with no fork and no
 * flush (the `AuditPort.recordWithin` shape): the entry lands when the caller's
 * transaction commits and is gone when it rolls back. That is what lets a
 * reminder's delivery row — whose unique key is the claim — and its bell entry
 * be one write, so the bell is told exactly once (SC-004).
 */
describe('admin_notifications — recordWithin on the record port', () => {
  let h: BackendServerHandle;

  const port = (): AdminNotificationRecordPort<EntityManager> =>
    h.container.resolve<AdminNotificationRecordPort<EntityManager>>('adminNotificationRecordPort');

  const input = (kind: string, overrides: Partial<RecordAdminNotificationInput> = {}): RecordAdminNotificationInput => ({
    audience: 'admin_user',
    targetAdminUserId: TEST_ADMIN_ID,
    kind,
    subjectType: 'task',
    title: 'Reminder: task TSK-000001',
    titleMessage: { scope: 'tasks', key: 'notifications.reminder.title', params: { number: 'TSK-000001' } },
    linkPath: '/tasks/x',
    ...overrides,
  });

  const rowsOf = (kind: string) => h.em().find(AdminNotification, { kind }, { filters: false });

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.em().nativeDelete(AdminNotification, { kind: { $like: 'test.record_within.%' } }, { filters: false });
    await teardownBackendServer(h);
  });

  it('writes nothing until the caller flushes, and commits with the caller', async () => {
    const kind = 'test.record_within.commit';
    const record = await h.em().transactional(async (em) => {
      const answered = port().recordWithin(em, input(kind));
      // Not flushed by the port: nothing is visible outside the transaction yet.
      expect(await rowsOf(kind)).toHaveLength(0);
      return answered;
    });

    expect(record).toMatchObject({
      audience: 'admin_user',
      targetAdminUserId: TEST_ADMIN_ID,
      kind,
      subjectType: 'task',
      title: 'Reminder: task TSK-000001',
      linkPath: '/tasks/x',
      titleMessage: { scope: 'tasks', key: 'notifications.reminder.title', params: { number: 'TSK-000001' } },
    });
    const rows = await rowsOf(kind);
    expect(rows.map((row) => row.id)).toEqual([record.id]);
  });

  it('is gone when the caller rolls back', async () => {
    const kind = 'test.record_within.rollback';
    await expect(
      h.em().transactional(async (em) => {
        port().recordWithin(em, input(kind));
        await em.flush();
        throw new Error('the caller changed its mind');
      }),
    ).rejects.toThrow('the caller changed its mind');

    expect(await rowsOf(kind)).toHaveLength(0);
  });

  it('refuses what record refuses, before anything is persisted', async () => {
    const kind = 'test.record_within.refused';
    await expect(
      h.em().transactional(async (em) => {
        port().recordWithin(em, input(kind, { targetAdminUserId: null }));
      }),
    ).rejects.toThrow(/targetAdminUserId is required/);
    await expect(
      h.em().transactional(async (em) => {
        port().recordWithin(em, input(kind, { bodyMessage: { scope: 'tasks', key: 'x' } }));
      }),
    ).rejects.toThrow(/bodyMessage requires a body/);

    expect(await rowsOf(kind)).toHaveLength(0);
  });

  it('leaves record unchanged: it commits on its own, whatever the caller does', async () => {
    const kind = 'test.record_within.record';
    await expect(
      h.em().transactional(async () => {
        await port().record(input(kind));
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(await rowsOf(kind)).toHaveLength(1);
  });
});
