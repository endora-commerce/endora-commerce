import { describe, expect, it, vi } from 'vitest';
import type { TransactionalEmailSendInput, TransactionalSendOutcome } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { ReturnsNotificationDispatch, type DispatchDeps, type NotificationCase } from './dispatch.js';
import type { AdminBell } from './admin-bell.js';

/**
 * `specs/180-off-platform-complaints/` T016 (FR-A02, FR-A10, FR-A20, FR-A31, FR-A44,
 * FR-A50, FR-A51; research R-2, R-5): what one `returns-notifications` job sends.
 */
const CASE_ID = '3f9a21c0-7b1e-4d2a-9c3b-0123456789ab';
const COMMENT_ID = '5b2c0d11-1111-4111-8111-111111111111';
const EVENT_ID = '7c3d0e22-2222-4222-8222-222222222222';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000a1';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000aa';

const baseCase = (over: Partial<NotificationCase> = {}): NotificationCase => ({
  id: CASE_ID,
  rmaNumber: null,
  kind: 'complaint',
  orderId: '00000000-0000-4000-8000-0000000000d1',
  salesChannelId: 'ch-1',
  customerAccountId: CUSTOMER_ID,
  organizationId: ORGANIZATION_ID,
  submittedAt: new Date('2026-11-13T09:30:00Z'),
  lines: [
    { productName: 'Widget', quantity: 2 },
    { productName: 'Gadget', quantity: 1 },
  ],
  ...over,
});

function harness(
  opts: {
    rc?: NotificationCase | null;
    send?: (input: TransactionalEmailSendInput) => Promise<TransactionalSendOutcome>;
    present?: boolean;
    adminBaseUrl?: string | null;
    customerEmail?: string | null;
    comment?: { id: string; returnCaseId: string; body: string; isCustomerVisible: boolean; notifyCustomer: boolean } | null;
  } = {},
) {
  const sent: TransactionalEmailSendInput[] = [];
  const log = vi.fn();
  const bell: AdminBell = {
    announceNewCase: vi.fn(async (_c, attempt) => {
      attempt.done.add('bell:a1');
      return { status: 'recorded' as const, adminUserIds: ['a1'] };
    }),
  };
  const send = vi.fn(async (input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> => {
    const outcome = opts.send ? await opts.send(input) : ({ status: 'sent' } as const);
    if (outcome.status === 'sent') sent.push(input);
    return outcome;
  });
  const deps: DispatchDeps = {
    isPresent: () => opts.present ?? true,
    store: {
      loadCase: vi.fn(async () => (opts.rc === undefined ? baseCase() : opts.rc)),
      loadComment: vi.fn(async () =>
        opts.comment === undefined
          ? { id: COMMENT_ID, returnCaseId: CASE_ID, body: 'Your parcel arrived.', isCustomerVisible: true, notifyCustomer: true }
          : opts.comment,
      ),
      loadGuestVerification: vi.fn(async () => null),
      loadStatus: vi.fn(async (code: string) =>
        code === 'received' ? { code, name: { en: 'Received', pl: 'Odebrane' }, defaultName: 'Received' } : null,
      ),
    },
    sender: () => ({ send }),
    customers: {
      findById: vi.fn(async () =>
        opts.customerEmail === null
          ? null
          : ({
              id: CUSTOMER_ID,
              email: opts.customerEmail ?? 'filer@example.test',
              firstName: 'Ewa',
              lastName: 'Nowak',
              deletedAt: null,
              anonymizedAt: null,
            } as never),
      ),
      findByEmail: vi.fn(async () => null),
    },
    organizations: { findById: vi.fn(async () => ({ id: ORGANIZATION_ID, name: 'Acme' }) as never) },
    language: async () => 'pl-PL',
    timeZone: async () => 'Europe/Warsaw',
    newCaseRecipients: async () => ({ recipients: ['a@shop.example', 'b@shop.example'], invalid: ['not-an-address'] }),
    bell,
    guestLinks: { verificationToken: (id: string) => `sealed-${id}`, trackingToken: (id: string, v: number) => `track-${id}-${v}` },
    storefrontBaseUrl: 'https://shop.example',
    adminBaseUrl: opts.adminBaseUrl === undefined ? 'https://admin.example' : opts.adminBaseUrl,
    log,
  };
  return { dispatch: new ReturnsNotificationDispatch(deps), sent, send, log, bell, deps };
}

describe('case_submitted', () => {
  it('sends the shop e-mail to every valid recipient and the confirmation to the filer, in the channel language', async () => {
    const { dispatch, sent, bell } = harness();
    const report = await dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID });

    const shop = sent.filter((m) => m.code === 'return_new_case');
    expect(shop.map((m) => m.to)).toEqual(['a@shop.example', 'b@shop.example']);
    for (const m of shop) {
      expect(m.messageId).toMatch(new RegExp(`^return_new_case:${CASE_ID}:[0-9a-f]{16}$`));
      expect(m.messageId).not.toContain('@');
      expect(m.language).toBe('pl-PL');
      expect(m.salesChannelId).toBe('ch-1');
      expect(m.variables).toEqual({
        caseReference: '#3F9A21C0',
        kindLabel: 'Reklamacja',
        customerName: 'Ewa Nowak',
        organizationName: 'Acme',
        productList: '2 × Widget, 1 × Gadget',
        offPlatform: '',
        submittedAt: expect.stringContaining('2026'),
        adminCaseUrl: `https://admin.example/returns/${CASE_ID}`,
      });
    }
    expect(shop[0]!.messageId).not.toBe(shop[1]!.messageId);

    const confirmation = sent.find((m) => m.code === 'return_submitted')!;
    expect(confirmation.to).toBe('filer@example.test');
    expect(confirmation.messageId).toBe(`return_submitted:${CASE_ID}`);
    expect(confirmation.variables).toEqual({
      caseReference: '#3F9A21C0',
      kindLabel: 'Reklamacja',
      productList: '2 × Widget, 1 × Gadget',
      submittedAt: expect.stringContaining('2026'),
      caseUrl: `https://shop.example/returns/${CASE_ID}`,
    });

    expect(bell.announceNewCase).toHaveBeenCalledTimes(1);
    expect(report.bell).toEqual({ status: 'recorded', adminUserIds: ['a1'] });
    expect(report.messages).toContainEqual({ code: 'return_new_case', recipient: 'shop', status: 'invalid_recipient' });
  });

  it('names the RMA number as the reference once there is one, and leaves the admin link empty without a base URL', async () => {
    const { dispatch, sent } = harness({ rc: baseCase({ rmaNumber: 'RMA-1042', kind: 'return' }), adminBaseUrl: null });
    await dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID });
    const shop = sent.find((m) => m.code === 'return_new_case')!;
    expect(shop.variables['caseReference']).toBe('RMA-1042');
    expect(shop.variables['kindLabel']).toBe('Zwrot');
    expect(shop.variables['adminCaseUrl']).toBe('');
  });

  it('reports every non-sent outcome with its reason, logs it, and does not throw', async () => {
    const { dispatch, log } = harness({
      send: async (input) => ({ status: input.code === 'return_submitted' ? 'deactivated' : 'no_transport' }),
    });
    const report = await dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID });
    expect(report.messages).toEqual(
      expect.arrayContaining([
        { code: 'return_new_case', recipient: 'shop', status: 'invalid_recipient' },
        { code: 'return_new_case', recipient: 'shop', status: 'no_transport' },
        { code: 'return_submitted', recipient: 'customer', status: 'deactivated' },
      ]),
    );
    expect(log).toHaveBeenCalledWith(
      '[returns] the return e-mail was not sent',
      expect.objectContaining({ returnCaseId: CASE_ID, kind: 'return_submitted', reason: 'deactivated' }),
    );
    expect(log).toHaveBeenCalledWith(
      '[returns] the return e-mail was not sent',
      expect.objectContaining({ kind: 'return_new_case', reason: 'invalid_recipient' }),
    );
  });

  it('reports no_recipient when the filer has no address', async () => {
    const { dispatch } = harness({ customerEmail: null });
    const report = await dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID });
    expect(report.messages).toContainEqual({ code: 'return_submitted', recipient: 'customer', status: 'no_recipient' });
  });

  it('rethrows a transport failure after the other messages were tried, keeping what went out', async () => {
    const failure = new Error('SMTP down');
    const { dispatch, sent, bell } = harness({
      send: async (input) => {
        if (input.to === 'a@shop.example') throw failure;
        return { status: 'sent' };
      },
    });
    const record = vi.fn(async () => undefined);
    await expect(dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID }, { done: [], record })).rejects.toBe(failure);
    expect(sent.map((m) => m.to)).toEqual(['b@shop.example', 'filer@example.test']);
    expect(bell.announceNewCase).toHaveBeenCalledTimes(1);
    const done = (record.mock.calls.at(-1) as unknown as [string[]])[0];
    expect(done).toContain('customer');
    expect(done).toContain('bell:a1');
    expect(done.filter((k) => k.startsWith('shop:'))).toHaveLength(1);
  });

  it('on a retry with recorded progress, resends no completed message and records no second bell entry', async () => {
    const first = harness({
      send: async (input) => {
        if (input.to === 'a@shop.example') throw new Error('SMTP down');
        return { status: 'sent' };
      },
    });
    let done: readonly string[] = [];
    await expect(
      first.dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID }, { done, record: async (d) => void (done = d) }),
    ).rejects.toThrow();

    const retry = harness();
    retry.bell.announceNewCase = vi.fn(async (_c, attempt) => {
      expect(attempt.done.has('bell:a1')).toBe(true);
      return { status: 'recorded' as const, adminUserIds: [] };
    });
    await retry.dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID }, { done, record: async () => undefined });
    expect(retry.sent.map((m) => m.to)).toEqual(['a@shop.example']);
  });

  it('does nothing for a case that no longer exists', async () => {
    const { dispatch, send } = harness({ rc: null });
    expect(await dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID })).toEqual({ skipped: 'gone', messages: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses with ModuleDisabledError while returns is off, before reading anything', async () => {
    const { dispatch, deps } = harness({ present: false });
    await expect(dispatch.dispatch({ kind: 'case_submitted', returnCaseId: CASE_ID })).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(deps.store.loadCase).not.toHaveBeenCalled();
  });
});

describe('comment_notify', () => {
  it('sends the comment to the filer with its body', async () => {
    const { dispatch, sent } = harness();
    await dispatch.dispatch({ kind: 'comment_notify', returnCaseCommentId: COMMENT_ID });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      code: 'return_comment_added',
      to: 'filer@example.test',
      messageId: `return_comment:${COMMENT_ID}`,
      language: 'pl-PL',
      variables: { caseReference: '#3F9A21C0', commentBody: 'Your parcel arrived.', caseUrl: `https://shop.example/returns/${CASE_ID}` },
    });
  });

  it('sends nothing for an internal comment or one without notify, and nothing for a deleted one', async () => {
    for (const comment of [
      { id: COMMENT_ID, returnCaseId: CASE_ID, body: 'x', isCustomerVisible: false, notifyCustomer: true },
      { id: COMMENT_ID, returnCaseId: CASE_ID, body: 'x', isCustomerVisible: true, notifyCustomer: false },
    ]) {
      const { dispatch, send } = harness({ comment });
      expect((await dispatch.dispatch({ kind: 'comment_notify', returnCaseCommentId: COMMENT_ID })).skipped).toBe('not_requested');
      expect(send).not.toHaveBeenCalled();
    }
    const gone = harness({ comment: null });
    expect((await gone.dispatch.dispatch({ kind: 'comment_notify', returnCaseCommentId: COMMENT_ID })).skipped).toBe('gone');
  });
});

describe('status_entered', () => {
  it('names the status in the channel language', async () => {
    const { dispatch, sent } = harness();
    await dispatch.dispatch({ kind: 'status_entered', returnCaseId: CASE_ID, statusCode: 'received', eventId: EVENT_ID });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      code: 'return_status_entered',
      to: 'filer@example.test',
      messageId: `return_status:${EVENT_ID}`,
      variables: { caseReference: '#3F9A21C0', statusName: 'Odebrane', caseUrl: `https://shop.example/returns/${CASE_ID}` },
    });
  });

  it('sends nothing for a status deleted since', async () => {
    const { dispatch, send } = harness();
    const report = await dispatch.dispatch({ kind: 'status_entered', returnCaseId: CASE_ID, statusCode: 'gone', eventId: EVENT_ID });
    expect(report.skipped).toBe('gone');
    expect(send).not.toHaveBeenCalled();
  });
});
