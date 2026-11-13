import { describe, expect, it } from 'vitest';
import { quoteRequestDeliverySchema } from '@endora-commerce/contracts';
import { deliveriesByEvent, type HistoryDeliveryInput } from './history-deliveries.js';

/**
 * `specs/179-rfq-and-customer-notifications/` WP-06 (FR-070; contract
 * `delivery-and-ports.md` §4) — the delivery records a History entry lists:
 * grouped by the history event they announce, each recipient named by the
 * directory the actors are named from, `''` when the person is gone.
 */

const EVENT_A = 'a0000000-0000-4000-8000-000000000001';
const EVENT_B = 'a0000000-0000-4000-8000-000000000002';
const ADMIN = 'b0000000-0000-4000-8000-000000000001';
const ADMIN_GONE = 'b0000000-0000-4000-8000-000000000002';
const ALICE = 'c0000000-0000-4000-8000-00000000000a';
const ZOE = 'c0000000-0000-4000-8000-00000000000b';
const NAMELESS = 'c0000000-0000-4000-8000-00000000000c';
const CUSTOMER_GONE = 'c0000000-0000-4000-8000-0000000000ff';

let seq = 0;
function record(extra: Partial<HistoryDeliveryInput> & Pick<HistoryDeliveryInput, 'recipientKind' | 'recipientId' | 'channel'>): HistoryDeliveryInput {
  seq += 1;
  return {
    id: `d0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sourceEventId: EVENT_A,
    status: 'pending',
    attempts: 0,
    lastError: null,
    closedAt: null,
    ...extra,
  };
}

const DIRECTORY = {
  admins: new Map([[ADMIN, { name: 'Carol Rep' }]]),
  customers: new Map([
    [ALICE, { name: 'Alice Asker', email: 'alice@example.test' }],
    [ZOE, { name: 'Zoe Buyer', email: 'zoe@example.test' }],
    [NAMELESS, { name: null, email: 'nameless@example.test' }],
  ]),
};

describe('deliveriesByEvent', () => {
  it('groups the records by the history event they announce', () => {
    const a = record({ recipientKind: 'customer', recipientId: ALICE, channel: 'customer_email' });
    const b = record({ recipientKind: 'admin', recipientId: ADMIN, channel: 'admin_in_app', sourceEventId: EVENT_B });
    const map = deliveriesByEvent([a, b], DIRECTORY);
    expect([...map.keys()].sort()).toEqual([EVENT_A, EVENT_B]);
    expect(map.get(EVENT_A)!.map((d) => d.id)).toEqual([a.id]);
    expect(map.get(EVENT_B)!.map((d) => d.id)).toEqual([b.id]);
  });

  it('answers the contract shape: recipient, channel, status, attempts, last error, closedAt', () => {
    const closedAt = new Date('2026-11-12T10:00:00.000Z');
    const failed = record({
      recipientKind: 'customer',
      recipientId: ALICE,
      channel: 'customer_email',
      status: 'failed',
      attempts: 5,
      lastError: 'SMTP 554 refused',
      closedAt,
    });
    const [delivery] = deliveriesByEvent([failed], DIRECTORY).get(EVENT_A)!;
    expect(quoteRequestDeliverySchema.parse(delivery)).toEqual({
      id: failed.id,
      channel: 'customer_email',
      recipient: { kind: 'customer', id: ALICE, displayName: 'Alice Asker' },
      status: 'failed',
      attempts: 5,
      lastError: 'SMTP 554 refused',
      closedAt: closedAt.toISOString(),
    });
  });

  it("names a recipient the directory does not hold '' (deleted, anonymised, or another module gone)", () => {
    const records = [
      record({ recipientKind: 'admin', recipientId: ADMIN_GONE, channel: 'admin_in_app' }),
      record({ recipientKind: 'customer', recipientId: CUSTOMER_GONE, channel: 'customer_email' }),
    ];
    const names = deliveriesByEvent(records, DIRECTORY)
      .get(EVENT_A)!
      .map((d) => d.recipient.displayName);
    expect(names).toEqual(['', '']);
  });

  it('names a customer without a name by the e-mail the History already shows for actors', () => {
    const [delivery] = deliveriesByEvent(
      [record({ recipientKind: 'customer', recipientId: NAMELESS, channel: 'customer_email' })],
      DIRECTORY,
    ).get(EVENT_A)!;
    expect(delivery!.recipient.displayName).toBe('nameless@example.test');
  });

  it('never looks a customer id up among the admins, nor the reverse', () => {
    const [delivery] = deliveriesByEvent(
      [record({ recipientKind: 'admin', recipientId: ALICE, channel: 'admin_in_app' })],
      DIRECTORY,
    ).get(EVENT_A)!;
    expect(delivery!.recipient.displayName).toBe('');
  });

  it('orders customers before operators, then by name, then by channel', () => {
    const records = [
      record({ recipientKind: 'admin', recipientId: ADMIN, channel: 'admin_email' }),
      record({ recipientKind: 'admin', recipientId: ADMIN, channel: 'admin_in_app' }),
      record({ recipientKind: 'customer', recipientId: ZOE, channel: 'customer_email' }),
      record({ recipientKind: 'customer', recipientId: ALICE, channel: 'customer_push' }),
      record({ recipientKind: 'customer', recipientId: ALICE, channel: 'customer_email' }),
    ];
    const order = deliveriesByEvent(records, DIRECTORY)
      .get(EVENT_A)!
      .map((d) => `${d.recipient.displayName}/${d.channel}`);
    expect(order).toEqual([
      'Alice Asker/customer_email',
      'Alice Asker/customer_push',
      'Zoe Buyer/customer_email',
      'Carol Rep/admin_in_app',
      'Carol Rep/admin_email',
    ]);
  });
});
