import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerAccountRecord,
  OrganizationRecord,
  TransactionalEmailSendInput,
  TransactionalEmailSender,
  TransactionalSendOutcome,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import type { Cart } from '../entities/cart.entity.js';
import {
  CART_APPROVAL_REQUESTED_EMAIL_CODE,
  CART_APPROVED_EMAIL_CODE,
  CART_REJECTED_EMAIL_CODE,
  approvalEmailLanguage,
  createCartApprovalEmailDispatch,
  organizationAdminRecipients,
  type CartApprovalEmailDeps,
} from './cart-approval-emails.js';

/**
 * Issue #651 — the cart-approval e-mails, which `CartApprovalService` called
 * through an optional `CartEmailDispatch` the composition never supplied.
 */

const ORG = 'org-1';
const CHANNEL = 'channel-pl';

function account(overrides: Partial<CustomerAccountRecord> & { id: string }): CustomerAccountRecord {
  return {
    organizationId: ORG,
    email: `${overrides.id}@example.com`,
    firstName: 'First',
    lastName: overrides.id,
    role: 'regular_user',
    emailVerifiedAt: new Date(),
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    customFieldValues: {},
    deletedAt: null,
    customerGroupId: null,
    subtreeRollupEnabled: false,
    blockedAt: null,
    blockReason: null,
    blockSource: null,
    blockedByAdminUserId: null,
    blockedByCustomerAccountId: null,
    deletionRequestedByAdminUserId: null,
    anonymizedAt: null,
    ...overrides,
  };
}

const BUYER = account({ id: 'buyer', firstName: 'Anna', lastName: 'Kowalska' });
const ADMIN_1 = account({ id: 'admin-1', role: 'organization_admin', firstName: 'Jan', lastName: 'Nowak' });
const ADMIN_2 = account({ id: 'admin-2', role: 'organization_admin' });
const BLOCKED_ADMIN = account({ id: 'admin-blocked', role: 'organization_admin', blockedAt: new Date() });
const ANONYMISED_ADMIN = account({ id: 'admin-anon', role: 'organization_admin', anonymizedAt: new Date() });
const OTHER_MEMBER = account({ id: 'member-2' });

const MEMBERS = [ADMIN_1, ADMIN_2, BLOCKED_ADMIN, ANONYMISED_ADMIN, BUYER, OTHER_MEMBER];

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'cart-1',
    customerAccountId: BUYER.id,
    organizationId: ORG,
    salesChannelId: CHANNEL,
    submittedForApprovalAt: new Date('2026-11-03T10:00:00Z'),
    approvedAt: new Date('2026-11-03T11:00:00Z'),
    rejectedAt: new Date('2026-11-03T12:00:00Z'),
    ...overrides,
  } as Cart;
}

function harness(options: {
  outcome?: TransactionalSendOutcome;
  sendError?: unknown;
  sender?: boolean;
  channelLanguage?: string | null;
  members?: CustomerAccountRecord[];
} = {}) {
  const sent: TransactionalEmailSendInput[] = [];
  const sender: TransactionalEmailSender = {
    send: vi.fn(async (input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> => {
      if (options.sendError !== undefined) throw options.sendError;
      sent.push(input);
      return options.outcome ?? { status: 'sent' };
    }),
  };
  const members = options.members ?? MEMBERS;
  const log = vi.fn();
  const deps: CartApprovalEmailDeps = {
    sender: () => (options.sender === false ? undefined : sender),
    customerAccounts: {
      findById: vi.fn(async (id: string) => members.find((m) => m.id === id) ?? null),
      listByOrganization: vi.fn(async (organizationId: string) =>
        members.filter((m) => m.organizationId === organizationId),
      ),
    },
    organizations: {
      findById: vi.fn(async (id: string) => (id === ORG ? ({ id, name: 'Acme Sp. z o.o.' } as OrganizationRecord) : null)),
    },
    channelLanguage: vi.fn(async () => (options.channelLanguage === undefined ? 'pl-PL' : options.channelLanguage)),
    log,
  };
  return { dispatch: createCartApprovalEmailDispatch(deps), deps, sent, log, sender };
}

describe('organizationAdminRecipients (issue #651)', () => {
  it('answers the active, unblocked administrators of the Organization, never the submitter', async () => {
    const { deps } = harness();
    const recipients = await organizationAdminRecipients(deps.customerAccounts, ORG, BUYER.id);
    expect(recipients.map((r) => r.id)).toEqual([ADMIN_1.id, ADMIN_2.id]);
    expect(deps.customerAccounts.listByOrganization).toHaveBeenCalledWith(ORG, { activeOnly: true });
  });

  it('answers nobody for an Organization without an administrator', async () => {
    const { deps } = harness({ members: [BUYER, OTHER_MEMBER] });
    expect(await organizationAdminRecipients(deps.customerAccounts, ORG, BUYER.id)).toEqual([]);
  });
});

describe('approvalEmailLanguage (issue #651)', () => {
  it('renders in the language of the cart’s store, falling back to en-US', () => {
    expect(approvalEmailLanguage('pl-PL')).toBe('pl-PL');
    expect(approvalEmailLanguage('de-DE')).toBe('de-DE');
    expect(approvalEmailLanguage(null)).toBe('en-US');
    expect(approvalEmailLanguage('')).toBe('en-US');
  });
});

describe('createCartApprovalEmailDispatch (issue #651)', () => {
  it('on submit, tells every administrator of the Organization, once each, in the store’s language', async () => {
    const { dispatch, sent, deps } = harness();
    await dispatch.onSubmittedForApproval({
      cart: cart(),
      submitter: { customerAccountId: BUYER.id, organizationId: ORG },
    });
    expect(sent.map((s) => s.to)).toEqual([ADMIN_1.email, ADMIN_2.email]);
    for (const message of sent) {
      expect(message.code).toBe(CART_APPROVAL_REQUESTED_EMAIL_CODE);
      expect(message.language).toBe('pl-PL');
      expect(message.salesChannelId).toBe(CHANNEL);
      expect(message.variables).toMatchObject({
        buyer: { name: 'Anna Kowalska', email: BUYER.email },
        organization: { name: 'Acme Sp. z o.o.' },
        cart: { id: 'cart-1' },
      });
      expect(message.meta).toMatchObject({ kind: CART_APPROVAL_REQUESTED_EMAIL_CODE, cartId: 'cart-1' });
    }
    // One message id per administrator and per submission: a second submission
    // of the same cart is a new message, a retry of the same one is not.
    expect(new Set(sent.map((s) => s.messageId)).size).toBe(2);
    expect(sent[0]!.messageId).toBe(
      `${CART_APPROVAL_REQUESTED_EMAIL_CODE}:cart-1:${Date.parse('2026-11-03T10:00:00Z')}:${ADMIN_1.id}`,
    );
    expect(deps.channelLanguage).toHaveBeenCalledWith(CHANNEL);
  });

  it('on approve, tells the buyer who approved it', async () => {
    const { dispatch, sent } = harness({ channelLanguage: 'en-US' });
    await dispatch.onApproved({
      cart: cart(),
      approver: { customerAccountId: ADMIN_1.id, organizationId: ORG },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      code: CART_APPROVED_EMAIL_CODE,
      to: BUYER.email,
      language: 'en-US',
      messageId: `${CART_APPROVED_EMAIL_CODE}:cart-1:${Date.parse('2026-11-03T11:00:00Z')}`,
      variables: { approver: { name: 'Jan Nowak' }, organization: { name: 'Acme Sp. z o.o.' } },
    });
  });

  it('on reject, tells the buyer the reason', async () => {
    const { dispatch, sent } = harness();
    await dispatch.onRejected({
      cart: cart(),
      rejector: { customerAccountId: ADMIN_1.id, organizationId: ORG },
      reason: 'Over the monthly budget',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      code: CART_REJECTED_EMAIL_CODE,
      to: BUYER.email,
      language: 'pl-PL',
      variables: { reason: 'Over the monthly budget', rejector: { name: 'Jan Nowak' } },
    });
  });

  it('a store with no language and a cart with no store render in en-US on the platform-wide content', async () => {
    const { dispatch, sent, deps } = harness();
    await dispatch.onApproved({
      cart: cart({ salesChannelId: null }),
      approver: { customerAccountId: ADMIN_1.id, organizationId: ORG },
    });
    expect(sent[0]).toMatchObject({ salesChannelId: null, language: 'en-US' });
    expect(deps.channelLanguage).not.toHaveBeenCalled();
  });

  it('a buyer that no longer resolves is named in the log and sent nothing', async () => {
    const { dispatch, sent, log } = harness({ members: [ADMIN_1] });
    await dispatch.onApproved({
      cart: cart(),
      approver: { customerAccountId: ADMIN_1.id, organizationId: ORG },
    });
    expect(sent).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('not sent'),
      expect.objectContaining({ cartId: 'cart-1', code: CART_APPROVED_EMAIL_CODE, reason: 'no_recipient' }),
    );
  });

  it('a submit nobody can approve is named in the log', async () => {
    const { dispatch, sent, log } = harness({ members: [BUYER] });
    await dispatch.onSubmittedForApproval({
      cart: cart(),
      submitter: { customerAccountId: BUYER.id, organizationId: ORG },
    });
    expect(sent).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: CART_APPROVAL_REQUESTED_EMAIL_CODE, reason: 'no_recipient' }),
    );
  });

  it('no sender wired is named in the log, not thrown', async () => {
    const { dispatch, log } = harness({ sender: false });
    await expect(
      dispatch.onApproved({ cart: cart(), approver: { customerAccountId: ADMIN_1.id, organizationId: ORG } }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reason: 'no_sender' }));
  });

  it('an outcome other than sent is named in the log', async () => {
    const { dispatch, log } = harness({ outcome: { status: 'deactivated' } });
    await dispatch.onRejected({
      cart: cart(),
      rejector: { customerAccountId: ADMIN_1.id, organizationId: ORG },
      reason: 'No',
    });
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reason: 'deactivated' }));
  });

  it('a send that raises is contained and logged, and the next administrator is still told', async () => {
    const failing = harness();
    let calls = 0;
    failing.deps.sender = () => ({
      send: async (input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> => {
        calls += 1;
        if (calls === 1) throw new Error('smtp down');
        failing.sent.push(input);
        return { status: 'sent' };
      },
    });
    const dispatch = createCartApprovalEmailDispatch(failing.deps);
    await expect(
      dispatch.onSubmittedForApproval({
        cart: cart(),
        submitter: { customerAccountId: BUYER.id, organizationId: ORG },
      }),
    ).resolves.toBeUndefined();
    expect(failing.sent.map((s) => s.to)).toEqual([ADMIN_2.email]);
    expect(failing.log).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'failed', error: 'smtp down', recipientId: ADMIN_1.id }),
    );
  });

  it('a module switched off is logged and travels on as the presence answer, which the service absorbs after its write', async () => {
    // `CartApprovalService.dispatch` runs after the flush and swallows what the
    // dispatch raises, so the approval stands; the presence answer is not turned
    // into "nobody to tell" here (`rethrowIfModuleDisabled`, issue #84).
    const { dispatch, deps, log } = harness();
    deps.customerAccounts.findById = vi.fn(async () => {
      throw new ModuleDisabledError('customer_accounts');
    });
    await expect(
      dispatch.onApproved({ cart: cart(), approver: { customerAccountId: ADMIN_1.id, organizationId: ORG } }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reason: 'module_disabled' }));
  });
});
