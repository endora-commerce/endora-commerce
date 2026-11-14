import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type {
  AdminUserRecord,
  CustomerAccountRecord,
  CustomerPushInput,
  CustomerPushOutcome,
  RecordAdminNotificationInput,
  RecordCustomerNotificationInput,
  TransactionalEmailSendInput,
  TransactionalSendOutcome,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { QuoteRequest } from '../../entities/quote-request.entity.js';
import { QuoteRequestEvent } from '../../entities/quote-request-event.entity.js';
import { QuoteRequestNotification } from '../../entities/quote-request-notification.entity.js';
import { QuoteRequestRevision } from '../../entities/quote-request-revision.entity.js';
import {
  BELL_CHANGES,
  CENTRE_CHANGES,
  createChannelAdapters,
  customerEmailCode,
  pushOutcomeStatus,
  quoteRequestCentreText,
  quoteRequestStorefrontLinkPath,
  emailOutcomeStatus,
  operatorEmailCode,
  quoteRequestBellText,
  quoteRequestNumber,
  type ChannelAdapterDeps,
} from './channel-adapters.js';
import type { DeliveryContext } from './delivery-service.js';
import { NOTIFICATION_CHANGES, NOTIFICATION_MATRIX, type QuoteRequestNotificationChange } from './notification-matrix.js';

/**
 * `specs/179-rfq-and-customer-notifications/` FR-020 – FR-024, FR-030, FR-040 –
 * FR-048, FR-060 (T041, T042, T070, T092): what each adapter hands its channel's owner,
 * and how the owner's answer becomes the record's closing status
 * (`contracts/notification-matrix.md` §2, §4; `contracts/delivery-and-ports.md` §3).
 */

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;
const en = bundle('en');
const pl = bundle('pl');

const ORG = '10000000-0000-4000-8000-000000000001';
const RFQ_ID = '20000000-0000-4000-8000-0000000000aa';
const EVENT_ID = '30000000-0000-4000-8000-000000000001';
const ADMIN_ID = '40000000-0000-4000-8000-000000000001';
const REQUESTER_ID = '50000000-0000-4000-8000-000000000001';
const MEMBER_ID = '50000000-0000-4000-8000-000000000002';
const CHANNEL_ID = '60000000-0000-4000-8000-000000000001';
const DEFAULT_CHANNEL_ID = '60000000-0000-4000-8000-000000000002';
const ADMIN_ROLE = '70000000-0000-4000-8000-000000000001';
const MEMBER_ROLE = '70000000-0000-4000-8000-000000000002';
const PREVIOUS_ID = '20000000-0000-4000-8000-0000000000bb';
const REVISION_ID = '80000000-0000-4000-8000-000000000001';

function admin(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id: ADMIN_ID,
    email: 'olga.operator@example.com',
    firstName: 'Olga',
    lastName: 'Operator',
    adminRoleId: null,
    status: 'active',
    twoFactorEnabled: false,
    lastLoginAt: null,
    preferredLanguage: null,
    avatarAssetId: null,
    bio: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function account(overrides: Partial<CustomerAccountRecord> = {}): CustomerAccountRecord {
  return {
    id: REQUESTER_ID,
    organizationId: ORG,
    email: 'anna.buyer@example.com',
    firstName: 'Anna',
    lastName: 'Buyer',
    organizationRoleId: MEMBER_ROLE,
    deletedAt: null,
    blockedAt: null,
    anonymizedAt: null,
    ...overrides,
  } as CustomerAccountRecord;
}

function rfq(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return Object.assign(new QuoteRequest(), {
    id: RFQ_ID,
    organizationId: ORG,
    customerAccountId: REQUESTER_ID,
    businessId: 'QR-000153',
    salesChannelId: CHANNEL_ID,
    expiresAt: new Date('2026-12-01T12:00:00.000Z'),
    currentRevisionNumber: 2,
    ...overrides,
  });
}

function context(
  change: QuoteRequestNotificationChange,
  channel: QuoteRequestNotification['channel'],
  overrides: {
    rfq?: Partial<QuoteRequest>;
    event?: Partial<QuoteRequestEvent>;
    recipientId?: string;
    previous?: QuoteRequest | null;
    revision?: Partial<QuoteRequestRevision> | null;
  } = {},
): DeliveryContext & { em: { persisted: unknown[] } } {
  const record = Object.assign(new QuoteRequestNotification(), {
    id: '90000000-0000-4000-8000-000000000001',
    organizationId: ORG,
    quoteRequestId: RFQ_ID,
    sourceEventId: EVENT_ID,
    change,
    channel,
    recipientKind: channel.startsWith('admin_') ? 'admin' : 'customer',
    recipientId: overrides.recipientId ?? (channel.startsWith('admin_') ? ADMIN_ID : REQUESTER_ID),
  });
  const event = Object.assign(new QuoteRequestEvent(), {
    id: EVENT_ID,
    quoteRequestId: RFQ_ID,
    eventType: NOTIFICATION_MATRIX[change].sourceEventType,
    actorCustomerAccountId: REQUESTER_ID,
    payload: { type: NOTIFICATION_MATRIX[change].sourceEventType, ...NOTIFICATION_MATRIX[change].sourceDiscriminator },
    ...overrides.event,
  });
  const em = {
    persisted: [] as unknown[],
    count: vi.fn(async () => 3),
    findOne: vi.fn(async (entity: unknown) => {
      if (entity === QuoteRequest) return overrides.previous ?? null;
      if (entity === QuoteRequestRevision) {
        return overrides.revision === null
          ? null
          : Object.assign(new QuoteRequestRevision(), { id: REVISION_ID, revisionNumber: 4, ...overrides.revision });
      }
      return null;
    }),
  };
  return { em: em as never, record, rfq: rfq(overrides.rfq), sourceEvent: event };
}

function deps(overrides: Partial<ChannelAdapterDeps> = {}) {
  const sent: TransactionalEmailSendInput[] = [];
  let outcome: TransactionalSendOutcome = { status: 'sent' };
  const bellInputs: Array<{ em: unknown; input: RecordAdminNotificationInput }> = [];
  const centreInputs: Array<{ em: unknown; input: RecordCustomerNotificationInput }> = [];
  const pushInputs: CustomerPushInput[] = [];
  let pushOutcome: CustomerPushOutcome = 'enqueued';
  const value: ChannelAdapterDeps = {
    adminUsers: { findById: vi.fn(async (id: string) => (id === ADMIN_ID ? admin() : null)) },
    permissions: { listPermissions: vi.fn(async () => ['rfqs:handle']) },
    customerAccounts: {
      findById: vi.fn(async (id: string) =>
        id === REQUESTER_ID
          ? account()
          : id === MEMBER_ID
            ? account({ id: MEMBER_ID, email: 'maria.admin@example.com', firstName: 'Maria', lastName: 'Admin', organizationRoleId: ADMIN_ROLE })
            : null,
      ),
    },
    orgWideViewerRoleIds: vi.fn(async () => [ADMIN_ROLE]),
    organizations: { findById: vi.fn(async () => ({ id: ORG, name: 'Acme Sp. z o.o.' }) as never) },
    bell: {
      record: vi.fn(),
      recordWithin: vi.fn((em: unknown, input: RecordAdminNotificationInput) => {
        bellInputs.push({ em, input });
        return { id: 'bell-1' } as never;
      }),
    },
    centre: {
      record: vi.fn(),
      recordWithin: vi.fn((em: unknown, input: RecordCustomerNotificationInput) => {
        centreInputs.push({ em, input });
        return { id: 'centre-1', createdAt: new Date() };
      }),
    },
    sender: () => ({
      send: vi.fn(async (input: TransactionalEmailSendInput) => {
        sent.push(input);
        return outcome;
      }),
    }),
    push: {
      push: vi.fn(async (input: CustomerPushInput) => {
        pushInputs.push(input);
        return pushOutcome;
      }),
    },
    translate: vi.fn(
      async (key: string, language: string, params?: Record<string, string | number>) =>
        `[${language}] ${key} ${JSON.stringify(params ?? {})}`,
    ),
    channels: {
      getById: vi.fn(async (id: string) =>
        id === CHANNEL_ID
          ? ({ id, code: 'b2b', name: { 'pl-PL': 'Sklep B2B', 'en-US': 'B2B store' }, defaultLanguage: 'pl-PL' } as never)
          : null,
      ),
      getSystemDefault: vi.fn(
        async () => ({ id: DEFAULT_CHANNEL_ID, code: 'default', name: { 'en-US': 'Default' }, defaultLanguage: 'en-US' }) as never,
      ),
    },
    storefrontUrl: vi.fn(async () => 'https://shop.example.com/'),
    ...overrides,
  };
  return {
    value,
    sent,
    bellInputs,
    centreInputs,
    pushInputs,
    answer: (next: TransactionalSendOutcome) => {
      outcome = next;
    },
    answerPush: (next: CustomerPushOutcome) => {
      pushOutcome = next;
    },
  };
}

describe('the request number and the bell sentence', () => {
  it('names a request by its business id, or the first eight characters of its id', () => {
    expect(quoteRequestNumber({ id: RFQ_ID, businessId: 'QR-000153' })).toBe('QR-000153');
    expect(quoteRequestNumber({ id: RFQ_ID, businessId: '' })).toBe('20000000');
  });

  it('has a bell sentence exactly for the changes the matrix rings the bell for', () => {
    const rung = NOTIFICATION_CHANGES.filter((change) => NOTIFICATION_MATRIX[change].channels.admin_in_app !== null);
    expect([...BELL_CHANGES].sort()).toEqual([...rung].sort());
  });

  it.each(BELL_CHANGES.map((change) => [change]))(
    '%s: the English template filled with the params is the sentence, and both bundles hold the key',
    (change) => {
      const text = quoteRequestBellText(change, 'QR-000153');
      expect(text.titleMessage).toEqual({
        scope: 'quote_requests',
        key: `notifications.${change}.title`,
        params: { number: 'QR-000153' },
      });
      const template = en[text.titleMessage.key];
      expect(template).toBeTypeOf('string');
      expect(template!.replace('{number}', 'QR-000153')).toBe(text.title);
      expect(pl[text.titleMessage.key]).toContain('{number}');
      // Number only: nothing else about the request travels in a bell entry.
      expect(Object.keys(text.titleMessage.params ?? {})).toEqual(['number']);
    },
  );
});

describe('admin_in_app — the bell (FR-030, T041)', () => {
  it('records on the record’s EntityManager with the contract shape', async () => {
    const d = deps();
    const ctx = context('submitted', 'admin_in_app');
    const outcome = await createChannelAdapters(d.value).admin_in_app.deliver(ctx);
    expect(outcome).toEqual({ status: 'sent' });
    expect(d.bellInputs).toHaveLength(1);
    expect(d.bellInputs[0]!.em).toBe(ctx.em);
    expect(d.bellInputs[0]!.input).toEqual({
      audience: 'admin_user',
      targetAdminUserId: ADMIN_ID,
      kind: 'quote_requests.submitted',
      subjectType: 'quote_request',
      subjectId: RFQ_ID,
      title: 'Quote request QR-000153 was submitted',
      titleMessage: {
        scope: 'quote_requests',
        key: 'notifications.submitted.title',
        params: { number: 'QR-000153' },
      },
      linkPath: `/quote-requests/${RFQ_ID}`,
    });
  });

  it('owned by admin_notifications', () => {
    expect(createChannelAdapters(deps().value).admin_in_app.owner).toBe('admin_notifications');
  });

  it.each([
    ['no longer holds rfqs:handle', { permissions: { listPermissions: vi.fn(async () => ['orders:read']) } }],
    ['is inactive', { adminUsers: { findById: vi.fn(async () => admin({ status: 'inactive' })) } }],
    ['is deleted', { adminUsers: { findById: vi.fn(async () => admin({ deletedAt: new Date() })) } }],
    ['is gone', { adminUsers: { findById: vi.fn(async () => null) } }],
  ])('an administrator who %s is not told: skipped_no_recipient', async (_why, override) => {
    const d = deps(override as Partial<ChannelAdapterDeps>);
    const outcome = await createChannelAdapters(d.value).admin_in_app.deliver(context('submitted', 'admin_in_app'));
    expect(outcome).toEqual({ status: 'skipped_no_recipient' });
    expect(d.bellInputs).toHaveLength(0);
  });

  it('the wildcard role holds rfqs:handle', async () => {
    const d = deps({ permissions: { listPermissions: vi.fn(async () => ['*']) } });
    const outcome = await createChannelAdapters(d.value).admin_in_app.deliver(context('expired', 'admin_in_app'));
    expect(outcome).toEqual({ status: 'sent' });
  });
});

describe('customer_email (FR-020 – FR-022, FR-024, T042)', () => {
  it.each(NOTIFICATION_CHANGES.filter((change) => NOTIFICATION_MATRIX[change].channels.customer_email !== null))(
    '%s goes out under its own code',
    async (change) => {
      const d = deps();
      await createChannelAdapters(d.value).customer_email.deliver(context(change, 'customer_email'));
      expect(d.sent.map((input) => input.code)).toEqual([customerEmailCode(change)]);
      expect(customerEmailCode(change)).toBe(`quote_request_customer_${change}`);
    },
  );

  it('carries the record’s id as its message id, the request’s channel, its default language and the storefront link', async () => {
    const d = deps();
    const ctx = context('approved', 'customer_email');
    const outcome = await createChannelAdapters(d.value).customer_email.deliver(ctx);
    expect(outcome).toEqual({ status: 'sent' });
    const [input] = d.sent;
    expect(input).toMatchObject({
      code: 'quote_request_customer_approved',
      messageId: `quote_request_notification:${ctx.record.id}`,
      salesChannelId: CHANNEL_ID,
      language: 'pl-PL',
      to: 'anna.buyer@example.com',
    });
    expect(input!.variables).toMatchObject({
      quote: {
        number: 'QR-000153',
        url: `https://shop.example.com/quote-requests/${RFQ_ID}`,
        validUntil: new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long' }).format(new Date('2026-12-01T12:00:00.000Z')),
      },
      customer: { name: 'Anna Buyer' },
      organization: { name: 'Acme Sp. z o.o.' },
      channel: { name: 'Sklep B2B' },
    });
  });

  it('the approval e-mail carries no attachment (FR-022, Q2)', async () => {
    const d = deps();
    await createChannelAdapters(d.value).customer_email.deliver(context('approved', 'customer_email'));
    expect(d.sent[0]!.attachments).toBeUndefined();
  });

  it('a channel with no storefront address: the link is empty', async () => {
    const d = deps({ storefrontUrl: vi.fn(async () => null) });
    await createChannelAdapters(d.value).customer_email.deliver(context('canceled', 'customer_email'));
    expect((d.sent[0]!.variables['quote'] as Record<string, string>)['url']).toBe('');
  });

  it('an empty storefront address is no address', async () => {
    const d = deps({ storefrontUrl: vi.fn(async () => '  ') });
    await createChannelAdapters(d.value).customer_email.deliver(context('canceled', 'customer_email'));
    expect((d.sent[0]!.variables['quote'] as Record<string, string>)['url']).toBe('');
  });

  it('a request with no channel: en-US, no channel, no link', async () => {
    const d = deps();
    await createChannelAdapters(d.value).customer_email.deliver(
      context('expired', 'customer_email', { rfq: { salesChannelId: null } }),
    );
    expect(d.sent[0]).toMatchObject({ salesChannelId: null, language: 'en-US' });
    expect(d.sent[0]!.variables).toMatchObject({ quote: { url: '' }, channel: { name: '' } });
    expect(d.value.storefrontUrl).not.toHaveBeenCalled();
  });

  it('a channel that no longer resolves: en-US', async () => {
    const d = deps({ channels: { getById: vi.fn(async () => null), getSystemDefault: vi.fn() } });
    await createChannelAdapters(d.value).customer_email.deliver(context('expired', 'customer_email'));
    expect(d.sent[0]!.language).toBe('en-US');
  });

  it('names the actor, the reason, the previous number, the revision', async () => {
    const d = deps();
    const adapters = createChannelAdapters(d.value);
    await adapters.customer_email.deliver(
      context('offer_rejected', 'customer_email', {
        event: { payload: { type: 'canceled', canceledBy: 'customer', reason: 'Too expensive' } },
      }),
    );
    await adapters.customer_email.deliver(
      context('resubmitted', 'customer_email', {
        event: { payload: { type: 're-submitted', sourceRfqId: PREVIOUS_ID, newRfqId: RFQ_ID } },
        previous: Object.assign(new QuoteRequest(), { id: PREVIOUS_ID, businessId: 'QR-000150' }),
      }),
    );
    await adapters.customer_email.deliver(
      context('revised', 'customer_email', { event: { actorCustomerAccountId: null, revisionId: REVISION_ID } }),
    );
    expect(d.sent[0]!.variables).toMatchObject({ actor: { name: 'Anna Buyer' }, reason: 'Too expensive' });
    expect(d.sent[1]!.variables).toMatchObject({ actor: { name: 'Anna Buyer' }, quote: { previousNumber: 'QR-000150' } });
    expect(d.sent[2]!.variables).toMatchObject({ quote: { revisionNumber: '4' } });
  });

  it('a member who may open the request is written to under their own name', async () => {
    const d = deps();
    await createChannelAdapters(d.value).customer_email.deliver(
      context('approved', 'customer_email', { recipientId: MEMBER_ID }),
    );
    expect(d.sent[0]).toMatchObject({ to: 'maria.admin@example.com', variables: { customer: { name: 'Maria Admin' } } });
  });

  it.each([
    ['is gone', { id: 'x' }, 'nobody'],
    ['is deleted', { deletedAt: new Date() }, REQUESTER_ID],
    ['is blocked', { blockedAt: new Date() }, REQUESTER_ID],
    ['is anonymised', { anonymizedAt: new Date() }, REQUESTER_ID],
    ['has no address', { email: '' }, REQUESTER_ID],
    ['left the Organization', { organizationId: '10000000-0000-4000-8000-000000000009' }, REQUESTER_ID],
  ])('a recipient who %s is not written to: skipped_no_recipient', async (_why, overrides, recipientId) => {
    const d = deps({
      customerAccounts: {
        findById: vi.fn(async (id: string) => (id === REQUESTER_ID ? account(overrides as Partial<CustomerAccountRecord>) : null)),
      },
    });
    const outcome = await createChannelAdapters(d.value).customer_email.deliver(
      context('approved', 'customer_email', { recipientId }),
    );
    expect(outcome).toEqual({ status: 'skipped_no_recipient' });
    expect(d.sent).toHaveLength(0);
  });

  it('a member whose role no longer opens the request is not written to', async () => {
    const d = deps({ orgWideViewerRoleIds: vi.fn(async () => ['70000000-0000-4000-8000-00000000000f']) });
    const outcome = await createChannelAdapters(d.value).customer_email.deliver(
      context('approved', 'customer_email', { recipientId: MEMBER_ID }),
    );
    expect(outcome).toEqual({ status: 'skipped_no_recipient' });
  });

  it.each([
    [{ status: 'sent' }, { status: 'sent' }],
    [{ status: 'logged' }, { status: 'skipped_logged' }],
    [{ status: 'deactivated' }, { status: 'skipped_deactivated' }],
    [{ status: 'no_transport' }, { status: 'skipped_no_transport' }],
    [{ status: 'no_definition' }, { status: 'failed', lastError: 'no_definition' }],
  ] as const)('the sender answering %j closes the record %j (matrix §4)', async (answer, closing) => {
    expect(emailOutcomeStatus(answer)).toEqual(closing);
    const d = deps();
    d.answer(answer);
    expect(await createChannelAdapters(d.value).customer_email.deliver(context('approved', 'customer_email'))).toEqual(
      closing,
    );
  });

  it('no sender wired: skipped_no_transport', async () => {
    const d = deps({ sender: () => undefined });
    expect(await createChannelAdapters(d.value).customer_email.deliver(context('approved', 'customer_email'))).toEqual({
      status: 'skipped_no_transport',
    });
  });

  it('a send that raises is a failed attempt — thrown, with no recipient address in the error', async () => {
    const d = deps({
      sender: () => ({
        send: async () => {
          throw new Error('550 mailbox anna.buyer@example.com unavailable');
        },
      }),
    });
    const attempt = createChannelAdapters(d.value).customer_email.deliver(context('approved', 'customer_email'));
    await expect(attempt).rejects.toThrow('550 mailbox <recipient> unavailable');
  });

  it('a switched-off owner raised from the send is passed on as it is', async () => {
    const d = deps({
      sender: () => ({
        send: async () => {
          throw new ModuleDisabledError('transactional_emails');
        },
      }),
    });
    await expect(
      createChannelAdapters(d.value).customer_email.deliver(context('approved', 'customer_email')),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('owned by transactional_emails', () => {
    const adapters = createChannelAdapters(deps().value);
    expect(adapters.customer_email.owner).toBe('transactional_emails');
    expect(adapters.admin_email.owner).toBe('transactional_emails');
  });
});

describe('admin_email (FR-023, T042)', () => {
  it.each(NOTIFICATION_CHANGES.filter((change) => NOTIFICATION_MATRIX[change].channels.admin_email !== null))(
    '%s: its own code, the administrator’s preferred language, no channel, no link',
    async (change) => {
      const d = deps({ adminUsers: { findById: vi.fn(async () => admin({ preferredLanguage: 'pl' })) } });
      const ctx = context(change, 'admin_email', {
        previous: Object.assign(new QuoteRequest(), { id: PREVIOUS_ID, businessId: 'QR-000150' }),
        event: change === 'resubmitted' ? { payload: { type: 're-submitted', sourceRfqId: PREVIOUS_ID } } : {},
      });
      const outcome = await createChannelAdapters(d.value).admin_email.deliver(ctx);
      expect(outcome).toEqual({ status: 'sent' });
      expect(d.sent[0]).toMatchObject({
        code: operatorEmailCode(change),
        messageId: `quote_request_notification:${ctx.record.id}`,
        salesChannelId: null,
        language: 'pl-PL',
        to: 'olga.operator@example.com',
      });
      expect(operatorEmailCode(change)).toBe(`quote_request_operator_${change}`);
      expect(d.sent[0]!.variables).toMatchObject({
        quote: { number: 'QR-000153', lineCount: '3' },
        customer: { name: 'Olga Operator' },
        actor: { name: 'Anna Buyer' },
        organization: { name: 'Acme Sp. z o.o.' },
        channel: { name: 'Sklep B2B' },
      });
      expect((d.sent[0]!.variables['quote'] as Record<string, unknown>)['url']).toBeUndefined();
    },
  );

  it.each([
    [null, 'en-US'],
    ['en', 'en-US'],
    ['de-DE', 'en-US'],
    ['pl-PL', 'pl-PL'],
  ])('preferred language %s writes in %s', async (preferredLanguage, language) => {
    const d = deps({ adminUsers: { findById: vi.fn(async () => admin({ preferredLanguage })) } });
    await createChannelAdapters(d.value).admin_email.deliver(context('submitted', 'admin_email'));
    expect(d.sent[0]!.language).toBe(language);
  });

  it('an administrator who no longer holds rfqs:handle is not written to', async () => {
    const d = deps({ permissions: { listPermissions: vi.fn(async () => []) } });
    expect(await createChannelAdapters(d.value).admin_email.deliver(context('submitted', 'admin_email'))).toEqual({
      status: 'skipped_no_recipient',
    });
    expect(d.sent).toHaveLength(0);
  });
});

describe('customer_in_app — the customer notification centre (FR-040 – FR-048, T070)', () => {
  it('records on the record’s EntityManager with the contract shape, scoped to the request’s Organization and channel', async () => {
    const d = deps();
    const ctx = context('approved', 'customer_in_app');
    const outcome = await createChannelAdapters(d.value).customer_in_app.deliver(ctx);
    expect(outcome).toEqual({ status: 'sent' });
    expect(d.centreInputs).toHaveLength(1);
    expect(d.centreInputs[0]!.em).toBe(ctx.em);
    expect(d.centreInputs[0]!.input).toEqual({
      organizationId: ORG,
      customerAccountId: REQUESTER_ID,
      salesChannelId: CHANNEL_ID,
      sourceModule: 'quote_requests',
      sourceKey: ctx.record.id,
      kind: 'quote_requests.approved',
      subjectType: 'quote_request',
      subjectId: RFQ_ID,
      title: 'Quote request QR-000153 was approved',
      titleMessage: {
        scope: 'quote_requests',
        key: 'customerNotifications.approved.title',
        params: { number: 'QR-000153' },
      },
      linkPath: `/quote-requests/${RFQ_ID}`,
    });
  });

  it('owned by customer_notifications', () => {
    expect(createChannelAdapters(deps().value).customer_in_app.owner).toBe('customer_notifications');
  });

  it('has a centre sentence exactly for the changes the matrix writes a centre entry for', () => {
    const written = NOTIFICATION_CHANGES.filter((change) => NOTIFICATION_MATRIX[change].channels.customer_in_app !== null);
    expect([...CENTRE_CHANGES].sort()).toEqual([...written].sort());
  });

  it.each(CENTRE_CHANGES.map((change) => [change]))(
    '%s: the English template filled with the params is the sentence, and both bundles hold the key',
    (change) => {
      const text = quoteRequestCentreText(change, 'QR-000153');
      expect(text.titleMessage).toEqual({
        scope: 'quote_requests',
        key: `customerNotifications.${change}.title`,
        params: { number: 'QR-000153' },
      });
      const template = en[text.titleMessage.key];
      expect(template).toBeTypeOf('string');
      expect(template!.replace('{number}', 'QR-000153')).toBe(text.title);
      expect(pl[text.titleMessage.key]).toContain('{number}');
      expect(pl[text.titleMessage.key]).not.toBe(template);
      // Number only: no product, price or Organization name travels into the centre (matrix §2).
      expect(Object.keys(text.titleMessage.params ?? {})).toEqual(['number']);
    },
  );

  it('links to the request’s storefront page, without a locale prefix', () => {
    expect(quoteRequestStorefrontLinkPath(RFQ_ID)).toBe(`/quote-requests/${RFQ_ID}`);
  });

  it('a request raised with no channel: an entry shown on every channel', async () => {
    const d = deps();
    await createChannelAdapters(d.value).customer_in_app.deliver(
      context('expired', 'customer_in_app', { rfq: { salesChannelId: null } }),
    );
    expect(d.centreInputs[0]!.input.salesChannelId).toBeNull();
  });

  it('a request with no business id is named by the start of its id', async () => {
    const d = deps();
    await createChannelAdapters(d.value).customer_in_app.deliver(
      context('canceled', 'customer_in_app', { rfq: { businessId: '' } }),
    );
    expect(d.centreInputs[0]!.input.title).toBe('Quote request 20000000 was canceled');
  });

  it('a member who may open the request gets an entry of their own', async () => {
    const d = deps();
    await createChannelAdapters(d.value).customer_in_app.deliver(
      context('submitted', 'customer_in_app', { recipientId: MEMBER_ID }),
    );
    expect(d.centreInputs[0]!.input).toMatchObject({
      customerAccountId: MEMBER_ID,
      organizationId: ORG,
      title: 'Quote request QR-000153 was submitted',
    });
  });

  it('a recipient with no e-mail address still gets the entry — the centre needs none', async () => {
    const d = deps({
      customerAccounts: { findById: vi.fn(async () => account({ email: '' })) },
    });
    expect(await createChannelAdapters(d.value).customer_in_app.deliver(context('approved', 'customer_in_app'))).toEqual({
      status: 'sent',
    });
  });

  it.each([
    ['is gone', { id: 'x' }, 'nobody'],
    ['is deleted', { deletedAt: new Date() }, REQUESTER_ID],
    ['is blocked', { blockedAt: new Date() }, REQUESTER_ID],
    ['is anonymised', { anonymizedAt: new Date() }, REQUESTER_ID],
    ['left the Organization', { organizationId: '10000000-0000-4000-8000-000000000009' }, REQUESTER_ID],
  ])('a recipient who %s gets no entry: skipped_no_recipient', async (_why, overrides, recipientId) => {
    const d = deps({
      customerAccounts: {
        findById: vi.fn(async (id: string) => (id === REQUESTER_ID ? account(overrides as Partial<CustomerAccountRecord>) : null)),
      },
    });
    const outcome = await createChannelAdapters(d.value).customer_in_app.deliver(
      context('approved', 'customer_in_app', { recipientId }),
    );
    expect(outcome).toEqual({ status: 'skipped_no_recipient' });
    expect(d.centreInputs).toHaveLength(0);
  });

  it('a member whose role no longer opens the request gets no entry (SC-003)', async () => {
    const d = deps({ orgWideViewerRoleIds: vi.fn(async () => ['70000000-0000-4000-8000-00000000000f']) });
    const outcome = await createChannelAdapters(d.value).customer_in_app.deliver(
      context('approved', 'customer_in_app', { recipientId: MEMBER_ID }),
    );
    expect(outcome).toEqual({ status: 'skipped_no_recipient' });
    expect(d.centreInputs).toHaveLength(0);
  });

  it('a switched-off centre raised from the port is passed on as it is (closed skipped_module_off by the delivery service)', async () => {
    const d = deps({
      centre: {
        record: vi.fn(),
        recordWithin: vi.fn(() => {
          throw new ModuleDisabledError('customer_notifications');
        }),
      },
    });
    await expect(
      createChannelAdapters(d.value).customer_in_app.deliver(context('approved', 'customer_in_app')),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});

describe('customer_push — the buyer’s devices, through customerPushPort (FR-060, T092)', () => {
  it('pushes the centre’s sentence in the request channel’s language, keyed by the record id', async () => {
    const d = deps();
    const ctx = context('approved', 'customer_push');
    expect(await createChannelAdapters(d.value).customer_push.deliver(ctx)).toEqual({ status: 'sent' });
    expect(d.pushInputs).toEqual([
      {
        organizationId: ORG,
        customerAccountId: REQUESTER_ID,
        salesChannelId: CHANNEL_ID,
        category: 'quote',
        title: '[pl] customerPush.title {}',
        body: '[pl] customerNotifications.approved.title {"number":"QR-000153"}',
        url: `/quote-requests/${RFQ_ID}`,
        sourceKey: ctx.record.id,
      },
    ]);
  });

  it('owned by pwa', () => {
    expect(createChannelAdapters(deps().value).customer_push.owner).toBe('pwa');
  });

  it('a request raised with no channel: the system default channel’s language, and no channel named to the port', async () => {
    const d = deps();
    await createChannelAdapters(d.value).customer_push.deliver(
      context('expired', 'customer_push', { rfq: { salesChannelId: null } }),
    );
    expect(d.pushInputs[0]).toMatchObject({
      salesChannelId: null,
      title: '[en] customerPush.title {}',
      body: '[en] customerNotifications.expired.title {"number":"QR-000153"}',
    });
  });

  it('a channel language with no bundle falls back to English', async () => {
    const d = deps({
      channels: {
        getById: vi.fn(async () => ({ id: CHANNEL_ID, code: 'de', name: {}, defaultLanguage: 'de-DE' }) as never),
        getSystemDefault: vi.fn(),
      },
    });
    await createChannelAdapters(d.value).customer_push.deliver(context('revised', 'customer_push'));
    expect(d.pushInputs[0]!.body).toBe('[en] customerNotifications.revised.title {"number":"QR-000153"}');
  });

  it('a member who may open the request is pushed to on their own account', async () => {
    const d = deps();
    await createChannelAdapters(d.value).customer_push.deliver(
      context('submitted', 'customer_push', { recipientId: MEMBER_ID }),
    );
    expect(d.pushInputs[0]).toMatchObject({ customerAccountId: MEMBER_ID, organizationId: ORG });
  });

  it('both bundles hold the push title', () => {
    expect(en['customerPush.title']).toBeTypeOf('string');
    expect(pl['customerPush.title']).toBeTypeOf('string');
    expect(pl['customerPush.title']).not.toBe(en['customerPush.title']);
  });

  it.each([
    ['enqueued', 'sent'],
    ['skipped:customer_preference', 'skipped_preference'],
    ['skipped:no_account', 'skipped_no_recipient'],
    ['skipped:no_subscription', 'skipped_no_subscription'],
    ['skipped:switched_off', 'skipped_deactivated'],
  ] as const)('the port’s %s closes the record %s (contracts/delivery-and-ports.md §3)', async (answer, status) => {
    expect(pushOutcomeStatus(answer)).toEqual({ status });
    const d = deps();
    d.answerPush(answer);
    expect(await createChannelAdapters(d.value).customer_push.deliver(context('approved', 'customer_push'))).toEqual({
      status,
    });
  });

  it.each([
    ['is gone', { id: 'x' }, 'nobody'],
    ['is blocked', { blockedAt: new Date() }, REQUESTER_ID],
    ['left the Organization', { organizationId: '10000000-0000-4000-8000-000000000009' }, REQUESTER_ID],
  ])('a recipient who %s is not pushed to: skipped_no_recipient', async (_why, overrides, recipientId) => {
    const d = deps({
      customerAccounts: {
        findById: vi.fn(async (id: string) => (id === REQUESTER_ID ? account(overrides as Partial<CustomerAccountRecord>) : null)),
      },
    });
    const outcome = await createChannelAdapters(d.value).customer_push.deliver(
      context('approved', 'customer_push', { recipientId }),
    );
    expect(outcome).toEqual({ status: 'skipped_no_recipient' });
    expect(d.pushInputs).toHaveLength(0);
  });

  it('a member whose role no longer opens the request is not pushed to (SC-003)', async () => {
    const d = deps({ orgWideViewerRoleIds: vi.fn(async () => ['70000000-0000-4000-8000-00000000000f']) });
    expect(
      await createChannelAdapters(d.value).customer_push.deliver(context('approved', 'customer_push', { recipientId: MEMBER_ID })),
    ).toEqual({ status: 'skipped_no_recipient' });
    expect(d.pushInputs).toHaveLength(0);
  });

  it('a switched-off pwa raised from the port is passed on as it is (closed skipped_module_off by the delivery service)', async () => {
    const d = deps({
      push: {
        push: vi.fn(async () => {
          throw new ModuleDisabledError('pwa');
        }),
      },
    });
    await expect(
      createChannelAdapters(d.value).customer_push.deliver(context('approved', 'customer_push')),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('a failing port is a failed attempt: the error is thrown for the retry ladder', async () => {
    const d = deps({ push: { push: vi.fn(async () => Promise.reject(new Error('redis down'))) } });
    await expect(
      createChannelAdapters(d.value).customer_push.deliver(context('approved', 'customer_push')),
    ).rejects.toThrow('redis down');
  });
});
