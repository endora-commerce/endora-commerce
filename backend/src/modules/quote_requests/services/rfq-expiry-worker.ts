import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { RfqEventBus } from './rfq-service.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqNotificationService, NotificationRecipient } from './rfq-notification-service.js';
import type { SalesRepAssignmentService } from '../../organizations/services/sales-rep-assignment-service.js';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';
import { withSystemScope } from '../../../tenancy/escape-hatch.js';

/**
 * RfqExpiryWorker — feature 008 sweep that flips Pending and
 * Created from admin Quote Requests past the configured expiry to
 * `Expired`, writes a corresponding event row, and fans out
 * notifications to both parties (FR-030).
 *
 * `expiryDays = 0` disables the sweep entirely. Otherwise the worker
 * scans rows where `updated_at < now() - INTERVAL '<expiryDays> days'`,
 * which catches modifications + draft submissions equally.
 *
 * Public `sweep()` is a plain async function so tests can drive it
 * directly without Redis/BullMQ.
 */

declare module './rfq-service.js' {
  interface RfqEvents {
    'rfq.expired.v1': import('../../../events/bus.js').EventBase & { rfqId: string };
  }
}

export interface RfqExpiryWorkerDeps {
  emFactory: () => EntityManager;
  events: RfqEventBus;
  eventService: RfqEventService;
  notificationService: RfqNotificationService;
  salesRepAssignment: SalesRepAssignmentService;
  /** Resolves the current `quote_requests.expiryDays` from settings.
   * Implementation lives in plugin.ts so the worker isn't coupled to
   * the settings module's read API. */
  resolveExpiryDays: () => Promise<number>;
}

export class RfqExpiryWorker {
  constructor(private readonly deps: RfqExpiryWorkerDeps) {}

  async sweep(now: Date = new Date()): Promise<{ expiredCount: number }> {
    // command-coverage-ignore: background expiry sweep — flips overdue RFQs to
    // Expired on a timer, a system lifecycle job, not an operator-initiated write.
    // Feature 050 — system-wide sweep across all orgs; run under a system scope
    // so the QuoteRequest reads/writes carry a tenant context (fail-closed guard).
    return withSystemScope('rfq-expiry sweep', async () => {
    const expiryDays = await this.deps.resolveExpiryDays();
    if (!Number.isFinite(expiryDays) || expiryDays <= 0) {
      return { expiredCount: 0 };
    }

    const em = this.deps.emFactory();
    const cutoff = new Date(now.getTime() - expiryDays * 86_400_000);
    const expirable = await em.find(QuoteRequest, {
      status: { $in: ['Pending', 'Created from admin'] },
      updatedAt: { $lt: cutoff },
    });
    if (expirable.length === 0) return { expiredCount: 0 };

    for (const rfq of expirable) {
      rfq.status = 'Expired';
      rfq.expiredAt = now;
      rfq.version += 1;
    }
    await em.flush();

    for (const rfq of expirable) {
      const evt = await this.deps.eventService.append({
        quoteRequestId: rfq.id,
        eventType: 'expired',
        actor: { roleLabel: 'System' },
        payload: { type: 'expired', expiryDaysAtTime: expiryDays },
      });

      const recipients: NotificationRecipient[] = [
        { customerAccountId: rfq.customerAccountId },
      ];
      const assignments = await this.deps.salesRepAssignment.listForOrganization(rfq.organizationId);
      if (assignments.length > 0) {
        for (const a of assignments) recipients.push({ adminUserId: a.adminUserId });
      } else {
        // Unassigned-org fallback — notify every active admin.
        const everyAdmin = await em.find(AdminUser, {});
        for (const a of everyAdmin) recipients.push({ adminUserId: a.id });
      }
      await this.deps.notificationService.enqueue({
        quoteRequestId: rfq.id,
        sourceEventId: evt.id,
        recipients,
        channels: ['email', 'in_app'],
      });

      this.deps.events.emit('rfq.expired.v1', {
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        rfqId: rfq.id,
      });
    }

    void CustomerAccount; // avoid tree-shaking the import — used elsewhere
    return { expiredCount: expirable.length };
    });
  }
}
