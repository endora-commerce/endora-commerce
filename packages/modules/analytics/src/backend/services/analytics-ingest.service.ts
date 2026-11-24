import type { EntityManager } from '@mikro-orm/postgresql';
import { ingestAnalyticsEventSchema, type IngestAnalyticsEvent } from '@endora-commerce/contracts';
import { AnalyticsEvent } from '../entities/analytics-event.entity.js';
import type { AnalyticsForwarder } from './ga4-forwarder.js';

/**
 * AnalyticsIngestService (T237 / FR-110).
 *
 * Validates each event in the batch independently — a single bad row should
 * not reject the whole batch. Persisted rows are also handed to the optional
 * GA4 forwarder; the forwarder is best-effort and never blocks ingest.
 */
export interface IngestResult {
  accepted: number;
  rejected: Array<{ index: number; reason: string }>;
}

/**
 * Who sent the batch and on which channel, as the server resolved them:
 * identity from `request.actor`, channel from the resolved request channel.
 * These are the only values stored on a row; the per-event `customerAccountId`,
 * `organizationId` and `salesChannelId` a client may still send are accepted by
 * the contract for backward compatibility and ignored here.
 */
export interface IngestContext {
  salesChannelId: string | null;
  customerAccountId: string | null;
  organizationId: string | null;
}

export class AnalyticsIngestService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly forwarder?: AnalyticsForwarder,
  ) {}

  async ingest(input: {
    events: IngestAnalyticsEvent[];
    context: IngestContext;
    requestId?: string;
  }): Promise<IngestResult> {
    const { context } = input;
    // command-coverage-ignore: telemetry/analytics ingestion — high-volume event
    // recording, not an audited domain-state mutation.
    const em = this.emFactory();
    const accepted: AnalyticsEvent[] = [];
    const rejected: IngestResult['rejected'] = [];

    input.events.forEach((raw, index) => {
      const parsed = ingestAnalyticsEventSchema.safeParse(raw);
      if (!parsed.success) {
        rejected.push({ index, reason: parsed.error.issues[0]?.message ?? 'invalid event' });
        return;
      }
      const ev = parsed.data;
      const row = em.create(AnalyticsEvent, {
        type: ev.type,
        ...(ev.occurredAt ? { occurredAt: new Date(ev.occurredAt) } : { occurredAt: new Date() }),
        ...(context.salesChannelId ? { salesChannelId: context.salesChannelId } : {}),
        ...(context.customerAccountId ? { customerAccountId: context.customerAccountId } : {}),
        ...(context.organizationId ? { organizationId: context.organizationId } : {}),
        ...(ev.sessionId !== undefined ? { sessionId: ev.sessionId } : {}),
        ...(ev.properties !== undefined ? { properties: ev.properties } : {}),
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      });
      accepted.push(row);
    });

    if (accepted.length > 0) {
      await em.persist(accepted).flush();
      if (this.forwarder?.enabled) {
        // Fire-and-forget; never block ingest on the external transport.
        void this.forwarder.forwardMany(accepted.map(toForwardPayload));
      }
    }

    return { accepted: accepted.length, rejected };
  }
}

function toForwardPayload(row: AnalyticsEvent): {
  type: string;
  occurredAt: string;
  salesChannelId?: string;
  customerAccountId?: string;
  organizationId?: string;
  sessionId?: string;
  properties?: Record<string, unknown>;
} {
  return {
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    ...(row.salesChannelId ? { salesChannelId: row.salesChannelId } : {}),
    ...(row.customerAccountId ? { customerAccountId: row.customerAccountId } : {}),
    ...(row.organizationId ? { organizationId: row.organizationId } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.properties ? { properties: row.properties } : {}),
  };
}
