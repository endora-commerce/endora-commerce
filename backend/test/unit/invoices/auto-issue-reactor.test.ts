import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  createAutoIssueReactor,
  type AutoIssueReactorDeps,
} from '../../../../packages/modules/invoices/src/backend/services/auto-issue-reactor.js';
import type { InvoiceEmailDispatchResult } from '../../../../packages/modules/invoices/src/backend/services/invoice-email-dispatch.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { SettingNotRegistered } from '../../../src/kernel/settings/settings.service.js';
import { INVOICES_SETTING_CODES } from '../../../../packages/modules/invoices/src/manifest.js';

/**
 * Issue #115 — the auto-issue reactor discarded the dispatch answer.
 *
 * It is the shape of issues #67 and #78 one layer up: `dispatch` already names
 * why a message did not go out, and the reactor threw that answer away, so an
 * invoice issued automatically and never delivered was indistinguishable from
 * one the customer received. The reactor is a subscriber — it has no caller to
 * answer — so "observed" here means written to the module's log with the
 * auto-issue context the dispatcher cannot know: which order triggered it, and
 * which number was drawn.
 *
 * No database: every collaborator is a fake.
 */

const ORDER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const INVOICE_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const CHANNEL_ID = 'aaaaaaaa-0000-4000-8000-000000000003';

interface Recorded {
  message: string;
  context: Record<string, unknown>;
}

interface Fakes {
  readonly logged: Recorded[];
  readonly dispatched: string[];
  readonly deps: AutoIssueReactorDeps;
}

function fakes(opts: {
  dispatch?: (invoiceId: string) => Promise<InvoiceEmailDispatchResult>;
  sendOnIssue?: boolean;
  issue?: () => Promise<never>;
  trigger?: () => Promise<string>;
  withDispatcher?: boolean;
}): Fakes {
  const logged: Recorded[] = [];
  const dispatched: string[] = [];

  const dispatcher = {
    async sendOnIssueEnabled(): Promise<boolean> {
      return opts.sendOnIssue ?? true;
    },
    async dispatch(invoiceId: string): Promise<InvoiceEmailDispatchResult> {
      dispatched.push(invoiceId);
      return opts.dispatch ? opts.dispatch(invoiceId) : { sent: true };
    },
  } as unknown as NonNullable<AutoIssueReactorDeps['emailDispatcher']>;

  const deps: AutoIssueReactorDeps = {
    emFactory: () =>
      ({
        // No invoice yet for this order — the idempotency probe passes through.
        findOne: async () => null,
      }) as unknown as ReturnType<AutoIssueReactorDeps['emFactory']>,
    invoiceService: {
      issue:
        opts.issue ??
        (async () => ({
          id: INVOICE_ID,
          orderId: ORDER_ID,
          number: 'FV 7/2026',
          salesChannelId: CHANNEL_ID,
        })),
    } as unknown as AutoIssueReactorDeps['invoiceService'],
    settingsService: {
      async get<T>(code: string, _channel: string | null, schema: z.ZodType<T>): Promise<T> {
        if (code === INVOICES_SETTING_CODES.AUTO_ISSUE_TRIGGER_STATUS) {
          if (opts.trigger) return schema.parse(await opts.trigger());
          return schema.parse('paid');
        }
        return schema.parse(undefined);
      },
    },
    ...(opts.withDispatcher === false ? {} : { emailDispatcher: dispatcher }),
    log: (message, context) => logged.push({ message, context }),
  };

  return { logged, dispatched, deps };
}

const PAID = { orderId: ORDER_ID, salesChannelId: CHANNEL_ID, to: 'paid' };

describe('invoices — the auto-issue reactor observes the dispatch result (#115)', () => {
  it('records the reason when the auto-issued invoice was not e-mailed', async () => {
    const { logged, deps } = fakes({
      dispatch: async () => ({ sent: false, reason: 'no_transport' }),
    });

    await createAutoIssueReactor(deps).onOrderStatusChanged(PAID);

    expect(logged).toHaveLength(1);
    expect(logged[0]!.context).toMatchObject({
      invoiceId: INVOICE_ID,
      orderId: ORDER_ID,
      number: 'FV 7/2026',
      reason: 'no_transport',
    });
  });

  it('stays quiet when the message went out', async () => {
    const { logged, dispatched, deps } = fakes({ dispatch: async () => ({ sent: true }) });

    await createAutoIssueReactor(deps).onOrderStatusChanged(PAID);

    expect(dispatched).toEqual([INVOICE_ID]);
    expect(logged).toHaveLength(0);
  });

  it('stays quiet when the operator switched send-on-issue off — that is a choice, not a loss', async () => {
    const { logged, dispatched, deps } = fakes({ sendOnIssue: false });

    await createAutoIssueReactor(deps).onOrderStatusChanged(PAID);

    expect(dispatched).toEqual([]);
    expect(logged).toHaveLength(0);
  });

  it('records an invoice this composition wired no sender for', async () => {
    const { logged, deps } = fakes({ withDispatcher: false });

    await createAutoIssueReactor(deps).onOrderStatusChanged(PAID);

    expect(logged).toHaveLength(1);
    expect(logged[0]!.context).toMatchObject({ invoiceId: INVOICE_ID, reason: 'no_sender' });
  });

  it('lets a switched-off module through the dispatch seam instead of swallowing it', async () => {
    const { logged, deps } = fakes({
      dispatch: async () => {
        throw new ModuleDisabledError('transactional_emails');
      },
    });

    await expect(createAutoIssueReactor(deps).onOrderStatusChanged(PAID)).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
    expect(logged).toHaveLength(0);
  });

  it('lets a switched-off module through the issuance seam instead of swallowing it', async () => {
    const { logged, deps } = fakes({
      issue: async () => {
        throw new ModuleDisabledError('invoices');
      },
    });

    await expect(createAutoIssueReactor(deps).onOrderStatusChanged(PAID)).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
    expect(logged).toHaveLength(0);
  });

  it('records a failed issuance and leaves manual issuance available', async () => {
    const { logged, dispatched, deps } = fakes({
      issue: async () => {
        throw new Error('numbering counter locked');
      },
    });

    await expect(
      createAutoIssueReactor(deps).onOrderStatusChanged(PAID),
    ).resolves.toBeUndefined();
    expect(dispatched).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.context).toMatchObject({ orderId: ORDER_ID });
    expect(String(logged[0]!.context['error'])).toContain('numbering counter locked');
  });

  it('treats an unregistered trigger setting as "no trigger" and nothing else', async () => {
    const unregistered = fakes({
      trigger: async () => {
        throw new SettingNotRegistered(INVOICES_SETTING_CODES.AUTO_ISSUE_TRIGGER_STATUS);
      },
    });
    await expect(
      createAutoIssueReactor(unregistered.deps).onOrderStatusChanged(PAID),
    ).resolves.toBeUndefined();
    expect(unregistered.dispatched).toEqual([]);

    // A defect in the read is not a missing setting: it must not read as "no
    // trigger configured", which is how a silent auto-issue gap survives.
    const broken = fakes({
      trigger: async () => {
        throw new Error('settings backend unreachable');
      },
    });
    await expect(
      createAutoIssueReactor(broken.deps).onOrderStatusChanged(PAID),
    ).rejects.toThrow('settings backend unreachable');
  });
});
