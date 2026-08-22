import { z } from 'zod';
import type {
  InvoiceEmailNotSentReason,
  OrderReadPort,
  OrderRecord,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
} from '../../../kernel/settings/settings.service.js';
import type { InvoiceService } from './invoice-service.js';
import type { InvoicePdfRenderer } from './invoice-pdf-renderer.js';
import type { SettingsReader } from './seller-settings.js';
import { INVOICES_SETTING_CODES } from '../manifest.js';

/**
 * Why the invoice e-mail did — or did not — go out (issue #103).
 *
 * `dispatch` used to answer a bare `boolean`, and the two send-on-issue call
 * sites discarded even that. Six unrelated situations therefore looked
 * identical from outside and four of them were silent: no sender wired, no
 * recipient, the operator switched the e-mail off, no template for the code, no
 * transport, and an error the FR-029 `catch` absorbed. An invoice was issued and
 * nothing anywhere said that no message had been sent.
 *
 * The seven reasons live in `@endora-commerce/contracts` since issue #149, because the admin
 * issue route answers with one and an API shape belongs there.
 */
export type { InvoiceEmailNotSentReason };

export type InvoiceEmailDispatchResult =
  | { sent: true }
  | { sent: false; reason: InvoiceEmailNotSentReason };

/**
 * Where a failed dispatch is reported. Injectable so a test can read it;
 * defaults to `console.warn`, which is what the rest of this layer uses.
 */
export type InvoiceEmailLog = (message: string, context: Record<string, unknown>) => void;

export interface InvoiceEmailDispatchDeps {
  /**
   * `orders`' published read model (feature 075, Phase C), which replaced this
   * dispatcher's `emFactory` outright: the only thing it ever asked an
   * `EntityManager` for was `em.findOne(Order, …)`, a query against another
   * module's table.
   */
  orderReadPort: OrderReadPort;
  invoiceService: InvoiceService;
  pdfRenderer: InvoicePdfRenderer;
  settingsService: SettingsReader;
  getSender: () => TransactionalEmailSender | undefined;
  resolveRecipientEmail: (order: OrderRecord) => Promise<string | null>;
  resolveLanguage: (salesChannelId: string | null) => Promise<string>;
  log?: InvoiceEmailLog;
}

/**
 * Dispatches the `invoice_issued` transactional email (feature 047, US5).
 * Builds template variables, optionally attaches the rendered PDF (attachment
 * mode) or supplies a storefront download link (link mode), and sends through
 * the transactional_emails sender. Idempotent on `messageId`.
 *
 * **Best-effort, and now audible.** A failure still never throws to the caller
 * — issuance must not be undone (FR-029) — but the tolerance is narrow: a
 * `ModuleDisabledError` is a presence answer and is re-thrown, everything else
 * is named in the result and written to the log. Issue #78 tracks the callers
 * that discard the result; the log is what covers them until it lands.
 *
 * An invoice whose order carries **no sales channel** is an ordinary case, not a
 * failure: every setting below is then read platform-wide (`null`, D-41), and
 * the send names the same `null`.
 */
export class InvoiceEmailDispatcher {
  private readonly log: InvoiceEmailLog;

  constructor(private readonly deps: InvoiceEmailDispatchDeps) {
    this.log = deps.log ?? ((message, context): void => console.warn(message, context));
  }

  async dispatch(
    invoiceId: string,
    opts: { mode?: 'attachment' | 'link'; messageId?: string } = {},
  ): Promise<InvoiceEmailDispatchResult> {
    try {
      const sender = this.deps.getSender();
      if (!sender) return this.notSent(invoiceId, 'no_sender');

      const detail = await this.deps.invoiceService.buildDetail(invoiceId);
      const order = await this.deps.orderReadPort.findById(detail.orderId);
      if (!order) return this.notSent(invoiceId, 'invoice_not_found');
      const to = await this.deps.resolveRecipientEmail(order);
      if (!to) return this.notSent(invoiceId, 'no_recipient');

      const channelId = detail.salesChannelId;
      const language = await this.deps.resolveLanguage(channelId);
      const mode = opts.mode ?? (await this.resolveMode(channelId));
      const baseUrl = await this.resolveBaseUrl(channelId);
      const downloadUrl = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/orders/${detail.orderId}/invoices/${detail.id}/pdf`
        : '';

      const variables: Record<string, unknown> = {
        invoice: {
          number: detail.number,
          total: detail.grossTotal.toFixed(2),
          currency: detail.currency,
          downloadUrl,
        },
        order: { businessId: order.businessId },
      };

      const attachments =
        mode === 'attachment'
          ? [
              {
                filename: `invoice-${detail.number.replace(/\W+/g, '_')}.pdf`,
                content: await this.deps.pdfRenderer.render(detail),
                contentType: 'application/pdf',
              },
            ]
          : undefined;

      const outcome = await sender.send({
        code: 'invoice_issued',
        salesChannelId: channelId,
        language,
        to,
        messageId: opts.messageId ?? `invoice_issued:${detail.id}`,
        variables,
        ...(attachments ? { attachments } : {}),
        // D-59 — the delivery record has to be findable by the document, not
        // only by the recipient: "was invoice FV 1/2026 delivered" is the
        // support question this whole record exists to answer.
        document: { type: 'invoice', id: detail.id },
        meta: { kind: 'invoice_issued', invoiceId: detail.id, orderId: detail.orderId },
      });
      if (outcome.status !== 'sent') return this.notSent(invoiceId, outcome.status);
      return { sent: true };
    } catch (error) {
      // A switched-off module is a presence answer about the whole operation,
      // not an e-mail that failed to render; absorbing it would report "sent
      // nothing" where the truthful answer is "this capability is off".
      rethrowIfModuleDisabled(error);
      // Everything else is contained: issuance is committed and must not be
      // undone because the message did not go out (FR-029). It is named, though.
      return this.notSent(invoiceId, 'failed', error);
    }
  }

  private notSent(
    invoiceId: string,
    reason: InvoiceEmailNotSentReason,
    error?: unknown,
  ): InvoiceEmailDispatchResult {
    this.log('[invoices] the invoice e-mail was not sent', {
      invoiceId,
      reason,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : error }),
    });
    return { sent: false, reason };
  }

  /**
   * The two conditions that degrade to the module's compiled-in default, and no
   * others: the setting is not registered yet, or it is scoped to a subset of
   * channels this read is not inside. A malformed channel id is a code defect
   * and propagates — the bare `catch` this replaces is precisely what turned the
   * `''` sentinel into a silent "not configured" (D-43, issue #103).
   */
  private async readSetting<T>(
    code: string,
    salesChannelId: string | null,
    schema: z.ZodType<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await this.deps.settingsService.get(code, salesChannelId, schema);
    } catch (error) {
      if (error instanceof SettingNotRegistered) return fallback;
      if (error instanceof SettingOutOfScopeForChannel) return fallback;
      throw error;
    }
  }

  private async resolveMode(channelId: string | null): Promise<'attachment' | 'link'> {
    return this.readSetting(
      INVOICES_SETTING_CODES.EMAIL_DELIVERY_MODE,
      channelId,
      z.enum(['attachment', 'link']),
      'attachment',
    );
  }

  private async resolveBaseUrl(channelId: string | null): Promise<string> {
    return this.readSetting(
      INVOICES_SETTING_CODES.STOREFRONT_BASE_URL,
      channelId,
      z.string(),
      '',
    );
  }

  /**
   * Whether send-on-issue is enabled for the channel — or, with no channel, for
   * the platform. It used to answer `false` for the no-channel case without
   * reading anything, which is how an invoice issued outside a channel reached
   * the operator with no e-mail and no explanation.
   */
  async sendOnIssueEnabled(channelId: string | null): Promise<boolean> {
    return this.readSetting(
      INVOICES_SETTING_CODES.EMAIL_SEND_ON_ISSUE,
      channelId,
      z.boolean(),
      false,
    );
  }
}
