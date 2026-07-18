import type { EntityManager } from '@mikro-orm/postgresql';
import { ingestAnalyticsEventSchema, type IngestAnalyticsEvent } from '@b2b/contracts';
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

export class AnalyticsIngestService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly forwarder?: AnalyticsForwarder,
  ) {}

  async ingest(input: {
    events: IngestAnalyticsEvent[];
    requestId?: string;
  }): Promise<IngestResult> {
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
        ...(ev.salesChannelId !== undefined ? { salesChannelId: ev.salesChannelId } : {}),
        ...(ev.customerAccountId !== undefined ? { customerAccountId: ev.customerAccountId } : {}),
        ...(ev.organizationId !== undefined ? { organizationId: ev.organizationId } : {}),
        ...(ev.sessionId !== undefined ? { sessionId: ev.sessionId } : {}),
        ...(ev.properties !== undefined ? { properties: ev.properties } : {}),
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      });
      accepted.push(row);
    });

    if (accepted.length > 0) {
      await em.persistAndFlush(accepted);
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
