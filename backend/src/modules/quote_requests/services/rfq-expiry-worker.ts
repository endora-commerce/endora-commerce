import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import type { RfqEventBus } from './rfq-service.js';

/**
 * RfqExpiryWorker (T078).
 *
 * Scans RFQs in `quoted` status whose `expires_at` has passed and flips them
 * to `expired`. Emits `rfq.expired.v1` per row so the webhook bridge and the
 * audit log can react.
 *
 * Designed to be run as a BullMQ repeatable job (every minute in production)
 * — but the public method is a plain async function so the test suite can
 * invoke it directly without standing up Redis/BullMQ.
 */

declare module './rfq-service.js' {
  interface RfqEvents {
    'rfq.expired.v1': import('../../../events/bus.js').EventBase & { rfqId: string };
  }
}

export class RfqExpiryWorker {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: RfqEventBus,
  ) {}

  async sweep(now: Date = new Date()): Promise<{ expiredCount: number }> {
    const em = this.emFactory();
    const expirable = await em.find(QuoteRequest, {
      status: 'quoted',
      expiresAt: { $lte: now },
    });
    if (expirable.length === 0) return { expiredCount: 0 };

    for (const rfq of expirable) {
      rfq.status = 'expired';
      rfq.version += 1;
    }
    await em.flush();

    for (const rfq of expirable) {
      this.events.emit('rfq.expired.v1', {
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        rfqId: rfq.id,
      });
    }

    return { expiredCount: expirable.length };
  }
}
