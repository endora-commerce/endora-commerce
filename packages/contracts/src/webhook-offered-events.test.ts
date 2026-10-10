import { describe, expect, it } from 'vitest';
import * as contracts from './index.js';

/**
 * The six catalogue, quote-request and credit-limit events offered to outbound
 * webhooks.
 *
 * The delivery bridge sends an event whole, so each payload is a published
 * contract: a strict schema, exact names, and nothing beyond the documented
 * fields. A field added to an emit without being added here fails the owning
 * module's integration test; a field added here is a reviewed change.
 */

const envelope = { eventId: '6f1e2a34-0000-4000-8000-000000000001', occurredAt: '2026-10-09T10:15:30.000Z' };
const PRODUCT_ID = '00000000-0000-4000-8000-000000000101';
const RFQ_ID = '00000000-0000-4000-8000-000000000201';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000aa';

const offered = [
  ['product.created.v1', contracts.ProductCreatedEventV1Schema, { ...envelope, productId: PRODUCT_ID, sku: 'SKU-1' }],
  [
    'product.updated.v1',
    contracts.ProductUpdatedEventV1Schema,
    { ...envelope, productId: PRODUCT_ID, changedFields: ['name', 'status'] },
  ],
  ['product.archived.v1', contracts.ProductArchivedEventV1Schema, { ...envelope, productId: PRODUCT_ID }],
  ['rfq.created.v1', contracts.RfqCreatedEventV1Schema, { ...envelope, rfqId: RFQ_ID, organizationId: ORGANIZATION_ID }],
  ['rfq.expired.v1', contracts.RfqExpiredEventV1Schema, { ...envelope, rfqId: RFQ_ID, organizationId: ORGANIZATION_ID }],
  [
    'credit_limit.adjusted.v1',
    contracts.CreditLimitAdjustedEventV1Schema,
    { ...envelope, organizationId: ORGANIZATION_ID, amount: 8000 },
  ],
] as const;

describe('events offered to outbound webhooks by catalog, quote_requests and credit_limits', () => {
  it('each module offers exactly its own names, in order, each with its schema', () => {
    expect(contracts.CATALOG_WEBHOOK_EVENT_TYPES).toEqual([
      'product.created.v1',
      'product.updated.v1',
      'product.archived.v1',
    ]);
    expect(contracts.QUOTE_REQUEST_WEBHOOK_EVENT_TYPES).toEqual(['rfq.created.v1', 'rfq.expired.v1']);
    expect(contracts.CREDIT_LIMIT_WEBHOOK_EVENT_TYPES).toEqual(['credit_limit.adjusted.v1']);

    const schemas: Record<string, unknown> = {
      ...contracts.CATALOG_WEBHOOK_EVENT_SCHEMAS,
      ...contracts.QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS,
      ...contracts.CREDIT_LIMIT_WEBHOOK_EVENT_SCHEMAS,
    };
    expect(Object.keys(schemas).sort()).toEqual(offered.map(([name]) => name).sort());
    for (const [name, schema] of offered) expect(schemas[name]).toBe(schema);
  });

  it('none of the six is built in — `webhooks` names no other module\'s event', () => {
    for (const [name] of offered) expect(contracts.WEBHOOK_BUILT_IN_EVENT_TYPES).not.toContain(name);
  });

  it('together with the built-in and CRM types they are eleven distinct names', () => {
    const all = contracts.deliverableWebhookEventTypes([
      ...contracts.CRM_WEBHOOK_EVENT_TYPES,
      ...contracts.CATALOG_WEBHOOK_EVENT_TYPES,
      ...contracts.QUOTE_REQUEST_WEBHOOK_EVENT_TYPES,
      ...contracts.CREDIT_LIMIT_WEBHOOK_EVENT_TYPES,
    ]);
    expect(all).toHaveLength(11);
    expect(new Set(all).size).toBe(11);
  });

  it.each(offered)('%s accepts its payload', (_name, schema, payload) => {
    expect(schema.parse(payload)).toEqual(payload);
  });

  it.each(offered)('%s refuses a field that is not part of the contract', (_name, schema, payload) => {
    expect(schema.safeParse({ ...payload, internalNote: 'must not leave the instance' }).success).toBe(false);
  });

  it.each(offered)('%s refuses a payload without its envelope', (_name, schema, payload) => {
    const { eventId: _eventId, ...withoutId } = payload;
    expect(schema.safeParse(withoutId).success).toBe(false);
  });

  it('the events of one Organization cannot omit it — the delivery filter depends on it', () => {
    expect(contracts.RfqCreatedEventV1Schema.safeParse({ ...envelope, rfqId: RFQ_ID }).success).toBe(false);
    expect(contracts.RfqExpiredEventV1Schema.safeParse({ ...envelope, rfqId: RFQ_ID }).success).toBe(false);
    expect(contracts.CreditLimitAdjustedEventV1Schema.safeParse({ ...envelope, amount: 1 }).success).toBe(false);
  });

  it('a product event carries no Organization — it is not one Organization\'s data', () => {
    for (const schema of Object.values(contracts.CATALOG_WEBHOOK_EVENT_SCHEMAS)) {
      expect(Object.keys(schema.shape)).not.toContain('organizationId');
    }
  });
});
