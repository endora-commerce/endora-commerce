import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { AnalyticsIngestService } from './analytics-ingest.service.js';
import type { AnalyticsForwarder } from './ga4-forwarder.js';

/**
 * Identity and channel on a stored analytics event come from the request the
 * server resolved, never from the event body. Body values for
 * `customerAccountId`, `organizationId` and `salesChannelId` are accepted for
 * backward compatibility and ignored.
 */
const BODY_CUSTOMER = '11111111-1111-4111-8111-111111111111';
const BODY_ORG = '22222222-2222-4222-8222-222222222222';
const BODY_CHANNEL = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';
const CHANNEL = '66666666-6666-4666-8666-666666666666';

function fakeEm(rows: Array<Record<string, unknown>>): () => EntityManager {
  const em = {
    create: (_entity: unknown, data: Record<string, unknown>) => {
      const row = { occurredAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    persist: () => ({ flush: async () => undefined }),
  };
  return () => em as unknown as EntityManager;
}

function capturingForwarder(sent: unknown[]): AnalyticsForwarder {
  return {
    enabled: true,
    forwardMany: async (events: unknown[]) => {
      sent.push(...events);
    },
  } as unknown as AnalyticsForwarder;
}

const bodyEvent = {
  type: 'product.viewed' as const,
  customerAccountId: BODY_CUSTOMER,
  organizationId: BODY_ORG,
  salesChannelId: BODY_CHANNEL,
  sessionId: 'sess-1',
};

describe('AnalyticsIngestService', () => {
  it('stores no identity for an anonymous request even when the body names one', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const service = new AnalyticsIngestService(fakeEm(rows));
    const result = await service.ingest({
      events: [bodyEvent],
      context: { salesChannelId: CHANNEL, customerAccountId: null, organizationId: null },
    });
    expect(result.accepted).toBe(1);
    expect(rows[0]).toMatchObject({ salesChannelId: CHANNEL, sessionId: 'sess-1' });
    expect(rows[0]!['customerAccountId']).toBeUndefined();
    expect(rows[0]!['organizationId']).toBeUndefined();
  });

  it('stamps the resolved customer, organization and channel over body values', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const sent: unknown[] = [];
    const service = new AnalyticsIngestService(fakeEm(rows), capturingForwarder(sent));
    await service.ingest({
      events: [bodyEvent],
      context: { salesChannelId: CHANNEL, customerAccountId: CUSTOMER, organizationId: ORG },
    });
    expect(rows[0]).toMatchObject({
      salesChannelId: CHANNEL,
      customerAccountId: CUSTOMER,
      organizationId: ORG,
    });
    await Promise.resolve();
    expect(sent).toEqual([
      expect.objectContaining({ salesChannelId: CHANNEL, customerAccountId: CUSTOMER, organizationId: ORG }),
    ]);
  });

  it('stores no channel when the request resolved none', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const service = new AnalyticsIngestService(fakeEm(rows));
    await service.ingest({
      events: [bodyEvent],
      context: { salesChannelId: null, customerAccountId: null, organizationId: null },
    });
    expect(rows[0]!['salesChannelId']).toBeUndefined();
  });
});
