import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { Invoice } from '../entities/invoice.entity.js';
import type { InvoiceService } from './invoice-service.js';
import type { InvoiceEmailDispatcher } from './invoice-email-dispatch.js';
import type { SettingsReader } from './seller-settings.js';
import { INVOICES_SETTING_CODES } from '../manifest.js';

export interface AutoIssueReactorDeps {
  emFactory: () => EntityManager;
  invoiceService: InvoiceService;
  settingsService: SettingsReader;
  /** Absent when this composition wired no transactional-email sender. */
  emailDispatcher?: InvoiceEmailDispatcher | undefined;
}

/**
 * FR-002 — issue an invoice when an order reaches the configured status.
 *
 * The **subscription** lives in this module's `backend.ts` and goes through
 * `ctx.subscribe` (issue #107). It was a bare `eventBus.on` in the plugin body,
 * and of the twenty-two such registrations this was the heaviest write: a
 * switched-off `invoices` module still issued a numbered legal document, took a
 * number out of the invoice sequence and e-mailed the PDF to the customer, while
 * the admin surface that would have shown it refused.
 *
 * Idempotent on `(orderId, kind='invoice')`, and best-effort throughout: manual
 * issuance stays available if anything here fails.
 */
export function createAutoIssueReactor(deps: AutoIssueReactorDeps): {
  onOrderStatusChanged: (payload: unknown) => Promise<void>;
} {
  return {
    async onOrderStatusChanged(payload: unknown): Promise<void> {
      const p = payload as { orderId?: string; salesChannelId?: string; to?: string };
      if (!p.orderId || !p.salesChannelId || !p.to) return;
      let trigger = '';
      try {
        trigger = await deps.settingsService.get(
          INVOICES_SETTING_CODES.AUTO_ISSUE_TRIGGER_STATUS,
          p.salesChannelId,
          z.string(),
        );
      } catch {
        trigger = '';
      }
      if (!trigger || trigger !== p.to) return;
      const em = deps.emFactory();
      const existing = await em.findOne(Invoice, { orderId: p.orderId, kind: 'invoice' });
      if (existing) return; // idempotent
      try {
        const detail = await deps.invoiceService.issue(p.orderId, 'invoice', {
          issuedBy: 'system',
        });
        const dispatcher = deps.emailDispatcher;
        if (dispatcher && (await dispatcher.sendOnIssueEnabled(detail.salesChannelId))) {
          // The `{ sent, reason }` answer is discarded here, exactly as the
          // plugin-body closure this was lifted out of discarded it — issue #107
          // moved the registration, not the behaviour. `dispatch` writes every
          // non-sent path to its own log (issue #103), which is what covers this
          // call site until issue #78 gives it somewhere to report to. Left for
          // that issue deliberately: the send-on-issue admin route discards the
          // same answer for the same reason, and the two are one decision — a
          // silent auto-issue has no caller to tell, so where the reason goes is
          // a design question rather than a missing `if`. (The resend route,
          // which does have a caller, already returns `reason`.)
          await dispatcher.dispatch(detail.id);
        }
      } catch {
        // Best-effort auto-issue; manual issuance remains available.
      }
    },
  };
}
