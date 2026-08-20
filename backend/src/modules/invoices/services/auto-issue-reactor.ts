import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { Invoice } from '../entities/invoice.entity.js';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
} from '../../../kernel/settings/settings.service.js';
import type { InvoiceDetail } from '@b2b/contracts';
import type { InvoiceService } from './invoice-service.js';
import type { InvoiceEmailDispatcher, InvoiceEmailLog } from './invoice-email-dispatch.js';
import type { SettingsReader } from './seller-settings.js';
import { INVOICES_SETTING_CODES } from '../manifest.js';

export interface AutoIssueReactorDeps {
  emFactory: () => EntityManager;
  invoiceService: InvoiceService;
  settingsService: SettingsReader;
  /** Absent when this composition wired no transactional-email sender. */
  emailDispatcher?: InvoiceEmailDispatcher | undefined;
  /**
   * Where an auto-issue that did not reach the customer is reported. Injectable
   * so a test can read it; defaults to `console.warn`, which is what the rest of
   * this layer uses.
   */
  log?: InvoiceEmailLog;
}

/** The message every non-delivery below is written under. */
const NOT_EMAILED = '[invoices] the auto-issued invoice was not e-mailed';

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
 * Idempotent on `(orderId, kind='invoice')`, and still best-effort: a failed
 * automatic attempt leaves manual issuance available. It is no longer *silent*
 * (issue #115). This subscriber has no caller to answer, so "observed" means
 * written to the log with the context only the reactor knows — which order
 * triggered the issuance, and which number it drew. Three things were swallowed
 * here and each now has a distinct outcome:
 *
 *   - a **non-sent dispatch**: `{ sent, reason }` was discarded exactly as the
 *     plugin-body closure it was lifted out of discarded it, so an invoice that
 *     was issued and never delivered read as success. The reason is recorded.
 *   - a **switched-off module**: the outer `catch {}` absorbed
 *     `ModuleDisabledError`, which is fail-closed turned into fail-open. It is
 *     re-thrown; the EventBus isolates and logs handler throws, so the presence
 *     answer surfaces instead of being confused with a transient failure.
 *   - a **defective settings read**: `catch { trigger = '' }` made every failure
 *     read as "no trigger configured" — the same `''` sentinel D-43 removed from
 *     the dispatcher. Only the two conditions that genuinely mean "not
 *     configured" degrade now.
 *
 * An operator who switched send-on-issue off is *not* a loss and is not logged:
 * that is a configured choice, not an undelivered message.
 */
export function createAutoIssueReactor(deps: AutoIssueReactorDeps): {
  onOrderStatusChanged: (payload: unknown) => Promise<void>;
} {
  const log: InvoiceEmailLog = deps.log ?? ((message, context): void => console.warn(message, context));

  /**
   * The trigger status, or `''` when the operator has not configured one. The
   * two conditions that degrade, and no others: the setting is not registered
   * yet, or it is scoped to a subset of channels this read is not inside.
   * Anything else — including a `ModuleDisabledError` from the settings port —
   * propagates.
   */
  async function readTrigger(salesChannelId: string): Promise<string> {
    try {
      return await deps.settingsService.get(
        INVOICES_SETTING_CODES.AUTO_ISSUE_TRIGGER_STATUS,
        salesChannelId,
        z.string(),
      );
    } catch (error) {
      if (error instanceof SettingNotRegistered) return '';
      if (error instanceof SettingOutOfScopeForChannel) return '';
      throw error;
    }
  }

  return {
    async onOrderStatusChanged(payload: unknown): Promise<void> {
      const p = payload as { orderId?: string; salesChannelId?: string; to?: string };
      if (!p.orderId || !p.salesChannelId || !p.to) return;
      const trigger = await readTrigger(p.salesChannelId);
      if (!trigger || trigger !== p.to) return;
      const em = deps.emFactory();
      const existing = await em.findOne(Invoice, { orderId: p.orderId, kind: 'invoice' });
      if (existing) return; // idempotent

      let detail: InvoiceDetail;
      try {
        detail = await deps.invoiceService.issue(p.orderId, 'invoice', {
          issuedBy: 'system',
        });
      } catch (error) {
        // Narrow and after the fact: the order has already moved status and
        // manual issuance stays available, so a failed automatic attempt must
        // not take the subscriber down. A switched-off module is not that — it
        // is a presence answer about the whole operation and is re-thrown.
        rethrowIfModuleDisabled(error);
        log('[invoices] the order was not auto-invoiced', {
          orderId: p.orderId,
          error: error instanceof Error ? error.message : error,
        });
        return;
      }

      const dispatcher = deps.emailDispatcher;
      if (!dispatcher) {
        // Same situation the dispatcher names `no_sender`, one layer earlier:
        // there is no dispatcher to name it, so the reactor does.
        log(NOT_EMAILED, {
          invoiceId: detail.id,
          orderId: p.orderId,
          number: detail.number,
          reason: 'no_sender',
        });
        return;
      }
      if (!(await dispatcher.sendOnIssueEnabled(detail.salesChannelId))) return;

      // Nothing catches here: `dispatch` contains its own failures and names
      // them in the result (FR-029), and the one thing it re-throws is a
      // presence answer that must reach the bus.
      const result = await dispatcher.dispatch(detail.id);
      if (result.sent) return;
      log(NOT_EMAILED, {
        invoiceId: detail.id,
        orderId: p.orderId,
        number: detail.number,
        reason: result.reason,
      });
    },
  };
}
