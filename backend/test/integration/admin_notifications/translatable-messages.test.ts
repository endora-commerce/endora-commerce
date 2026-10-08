import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * A bell entry may carry the address of a translatable sentence beside its
 * finished English one (`specs/143-crm-sales-opportunities/spec.md` FR-085,
 * research N-T1).
 *
 * One entry is read by several administrators in different languages, so the
 * writer cannot translate it (`specs/conventions/module-i18n.md`): it ships a
 * scope, a key and params, and the Admin UI resolves them. What this file
 * holds is the port's half — the message is stored and answered as it was
 * given, a caller that gives none is recorded exactly as before, and a message
 * that could not be drawn safely is refused where it is written rather than
 * discovered where it is read.
 */
describe('admin_notifications — translatable messages on the record port', () => {
  let h: BackendServerHandle;

  const port = (): AdminNotificationRecordPort =>
    h.container.resolve<AdminNotificationRecordPort>('adminNotificationRecordPort');

  const input = (overrides: Partial<RecordAdminNotificationInput> = {}): RecordAdminNotificationInput => ({
    audience: 'admin_user',
    targetAdminUserId: TEST_ADMIN_ID,
    kind: 'test.translatable',
    title: 'Ada mentioned you in opportunity OPP-000042',
    ...overrides,
  });

  const stored = (id: string) => h.em().findOneOrFail(AdminNotification, { id }, { filters: false });

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('stores and answers a title message and a body message as they were given', async () => {
    const titleMessage = {
      scope: 'crm',
      key: 'notifications.mention.title',
      params: { author: 'Ada', number: 'OPP-000042', count: 3 },
    };
    const bodyMessage = { scope: 'crm', key: 'notifications.mention.body' };
    const record = await port().record(input({ body: 'Open it to read on.', titleMessage, bodyMessage }));

    expect(record.title).toBe('Ada mentioned you in opportunity OPP-000042');
    expect(record.body).toBe('Open it to read on.');
    expect(record.titleMessage).toEqual(titleMessage);
    expect(record.bodyMessage).toEqual({ scope: 'crm', key: 'notifications.mention.body', params: {} });

    const row = await stored(record.id);
    expect(row.titleMessage).toEqual(titleMessage);
    expect(row.bodyMessage).toEqual({ scope: 'crm', key: 'notifications.mention.body', params: {} });
  });

  it('records a caller that gives no message exactly as before', async () => {
    const record = await port().record(input({ title: 'Plain title', body: 'Plain body' }));
    expect(record).toMatchObject({
      title: 'Plain title',
      body: 'Plain body',
      titleMessage: null,
      bodyMessage: null,
    });
    const row = await stored(record.id);
    expect(row.titleMessage ?? null).toBeNull();
    expect(row.bodyMessage ?? null).toBeNull();
  });

  it('treats an explicit null as no message', async () => {
    const record = await port().record(input({ titleMessage: null, bodyMessage: null }));
    expect(record.titleMessage).toBeNull();
    expect(record.bodyMessage).toBeNull();
  });

  it('accepts a key the admin bundles really use, colon included', async () => {
    const record = await port().record(
      input({ titleMessage: { scope: '_i18n', key: 'adminRoles.permission.crm:read' } }),
    );
    expect(record.titleMessage).toEqual({ scope: '_i18n', key: 'adminRoles.permission.crm:read', params: {} });
  });

  describe('refuses a message that could not be drawn', () => {
    const refused: Array<[string, Partial<RecordAdminNotificationInput>]> = [
      ['a body message with no body to fall back to', { bodyMessage: { scope: 'crm', key: 'a.b' } }],
      ['an empty key', { titleMessage: { scope: 'crm', key: '' } }],
      ['a key longer than a bundle key may be', { titleMessage: { scope: 'crm', key: 'k'.repeat(256) } }],
      ['an empty scope', { titleMessage: { scope: '', key: 'a.b' } }],
      ['a scope that is not a bundle namespace', { titleMessage: { scope: 'crm.notifications', key: 'a.b' } }],
      [
        'a param that is neither a string nor a number',
        { titleMessage: { scope: 'crm', key: 'a.b', params: { nested: { html: '<b>x</b>' } } as never } },
      ],
      ['a boolean param', { titleMessage: { scope: 'crm', key: 'a.b', params: { flag: true } as never } }],
      ['a number that is not finite', { titleMessage: { scope: 'crm', key: 'a.b', params: { n: Number.NaN } } }],
      ['params that are an array', { titleMessage: { scope: 'crm', key: 'a.b', params: ['x'] as never } }],
      ['a message that is not an object', { titleMessage: 'crm.a.b' as never }],
    ];

    it.each(refused)('%s', async (_name, overrides) => {
      const kind = `test.refused.${Math.random().toString(36).slice(2, 10)}`;
      await expect(port().record(input({ kind, ...overrides }))).rejects.toThrow(/AdminNotificationService\.record/);
      expect(await h.em().count(AdminNotification, { kind }, { filters: false })).toBe(0);
    });
  });
});
