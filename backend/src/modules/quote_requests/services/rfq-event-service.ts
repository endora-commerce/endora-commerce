import type { EntityManager } from '@mikro-orm/postgresql';
import { QuoteRequestEvent, type QuoteRequestEventType } from '../entities/quote-request-event.entity.js';

/**
 * RfqEventService — append-only writer for the change log that drives
 * the storefront and admin history block (FR-035 / FR-037).
 *
 * Every state-changing call in RfqService / RfqAdminService MUST funnel
 * through this service; it is the only authorised writer of
 * quote_request_events. The schema check on `event_type` lives at the
 * DB level (migration 029); the discriminated payload shape is enforced
 * by the route validators upstream (Zod schemas in @b2b/contracts).
 */
export interface RfqEventActor {
  adminUserId?: string | null;
  customerAccountId?: string | null;
  /** Display label shown to the customer ('Sales representative', 'Customer', …). */
  roleLabel?: string | null;
}

export interface AppendEventInput {
  quoteRequestId: string;
  eventType: QuoteRequestEventType;
  actor: RfqEventActor;
  payload: Record<string, unknown>;
  revisionId?: string | null;
}

export class RfqEventService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async append(input: AppendEventInput): Promise<QuoteRequestEvent> {
    const em = this.emFactory();
    const event = em.create(QuoteRequestEvent, {
      quoteRequestId: input.quoteRequestId,
      eventType: input.eventType,
      actorAdminUserId: input.actor.adminUserId ?? null,
      actorCustomerAccountId: input.actor.customerAccountId ?? null,
      actorRoleLabel: input.actor.roleLabel ?? null,
      payload: input.payload,
      revisionId: input.revisionId ?? null,
    });
    await em.persistAndFlush(event);
    return event;
  }

  async listForRfq(quoteRequestId: string, limit = 100): Promise<QuoteRequestEvent[]> {
    const em = this.emFactory();
    return em.find(
      QuoteRequestEvent,
      { quoteRequestId },
      { orderBy: { createdAt: 'asc' }, limit },
    );
  }
}
