import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { TransactionalEmailSender } from '@b2b/contracts';
import { Order } from '../../orders/entities/order.entity.js';
import type { InvoiceService } from './invoice-service.js';
import type { InvoicePdfRenderer } from './invoice-pdf-renderer.js';
import type { SettingsReader } from './seller-settings.js';
import { INVOICES_SETTING_CODES } from '../manifest.js';

export interface InvoiceEmailDispatchDeps {
  emFactory: () => EntityManager;
  invoiceService: InvoiceService;
  pdfRenderer: InvoicePdfRenderer;
  settingsService: SettingsReader;
  getSender: () => TransactionalEmailSender | undefined;
  resolveRecipientEmail: (order: Order) => Promise<string | null>;
  resolveLanguage: (salesChannelId: string | null) => Promise<string>;
}

/**
 * Dispatches the `invoice_issued` transactional email (feature 047, US5).
 * Builds template variables, optionally attaches the rendered PDF (attachment
 * mode) or supplies a storefront download link (link mode), and sends through
 * the transactional_emails sender. Idempotent on `messageId`. Best-effort: a
 * failure never throws to the caller (issuance must not be undone).
 */
export class InvoiceEmailDispatcher {
  constructor(private readonly deps: InvoiceEmailDispatchDeps) {}

  async dispatch(
    invoiceId: string,
    opts: { mode?: 'attachment' | 'link'; messageId?: string } = {},
  ): Promise<boolean> {
    try {
      const sender = this.deps.getSender();
      if (!sender) return false;

      const detail = await this.deps.invoiceService.buildDetail(invoiceId);
      const em = this.deps.emFactory();
      const order = await em.findOne(Order, { id: detail.orderId });
      if (!order) return false;
      const to = await this.deps.resolveRecipientEmail(order);
      if (!to) return false;

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

      await sender.send({
        code: 'invoice_issued',
        salesChannelId: channelId ?? '',
        language,
        to,
        messageId: opts.messageId ?? `invoice_issued:${detail.id}`,
        variables,
        ...(attachments ? { attachments } : {}),
        meta: { kind: 'invoice_issued', invoiceId: detail.id, orderId: detail.orderId },
      });
      return true;
    } catch {
      // Best-effort: never undo issuance because of an email failure (FR-029).
      return false;
    }
  }

  private async resolveMode(channelId: string | null): Promise<'attachment' | 'link'> {
    if (!channelId) return 'attachment';
    try {
      const v = await this.deps.settingsService.get(
        INVOICES_SETTING_CODES.EMAIL_DELIVERY_MODE,
        channelId,
        z.enum(['attachment', 'link']),
      );
      return v;
    } catch {
      return 'attachment';
    }
  }

  private async resolveBaseUrl(channelId: string | null): Promise<string> {
    if (!channelId) return '';
    try {
      return await this.deps.settingsService.get(
        INVOICES_SETTING_CODES.STOREFRONT_BASE_URL,
        channelId,
        z.string(),
      );
    } catch {
      return '';
    }
  }

  /** Whether send-on-issue is enabled for the channel. */
  async sendOnIssueEnabled(channelId: string | null): Promise<boolean> {
    if (!channelId) return false;
    try {
      return await this.deps.settingsService.get(
        INVOICES_SETTING_CODES.EMAIL_SEND_ON_ISSUE,
        channelId,
        z.boolean(),
      );
    } catch {
      return false;
    }
  }
}
