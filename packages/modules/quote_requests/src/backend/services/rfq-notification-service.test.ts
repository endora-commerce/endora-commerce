import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { QuoteRequestNotification } from '../entities/quote-request-notification.entity.js';
import type { QuoteRequestEvent } from '../entities/quote-request-event.entity.js';
import { NOTIFICATION_CHANNELS } from './notifications/notification-matrix.js';
import {
  RfqNotificationService,
  plannedNotifications,
  type NotificationRecipientResolver,
} from './rfq-notification-service.js';

/**
 * `specs/179-rfq-and-customer-notifications/` WP-02 (T012) — the recording
 * step writes one `quote_request_notifications` row per matrix cell, into the
 * caller's unit of work and nowhere else.
 */

const ORG = '00000000-0000-4000-8000-0000000000a1';
const RFQ = '00000000-0000-4000-8000-0000000000b1';
const REQUESTER = '00000000-0000-4000-8000-0000000000c1';
const COLLEAGUE = '00000000-0000-4000-8000-0000000000c2';
const REP = '00000000-0000-4000-8000-0000000000d1';
const OTHER_REP = '00000000-0000-4000-8000-0000000000d2';
const EVENT = '00000000-0000-4000-8000-0000000000e1';
const OCCURRED = new Date('2026-11-13T10:00:00.000Z');

const rfq = { id: RFQ, organizationId: ORG, customerAccountId: REQUESTER, assignedAdminUserId: null };

function event(eventType: QuoteRequestEvent['eventType'], payload: Record<string, unknown> = {}) {
  return { id: EVENT, eventType, payload: { type: eventType, ...payload }, createdAt: OCCURRED };
}

function rig(sides: { customer?: string[]; operator?: string[] } = {}) {
  const persisted: QuoteRequestNotification[] = [];
  const within = {
    create: (_entity: unknown, data: Record<string, unknown>) => Object.assign(new QuoteRequestNotification(), data),
    persist: vi.fn((row: QuoteRequestNotification) => {
      persisted.push(row);
    }),
    flush: vi.fn(async () => undefined),
  };
  const recipients: NotificationRecipientResolver = {
    customerSide: vi.fn(async () => sides.customer ?? [REQUESTER]),
    operatorSide: vi.fn(async () => sides.operator ?? [REP]),
  };
  const service = new RfqNotificationService(recipients);
  return { service, within, persisted, recipients, em: within as unknown as EntityManager };
}

describe('plannedNotifications — one cell per (recipient, channel), every channel considered', () => {
  const all = NOTIFICATION_CHANNELS;

  it('a submission: the actor keeps the e-mail, loses in-app and push; colleagues get all three; operators both', () => {
    const cells = plannedNotifications('submitted', { customer: [REQUESTER, COLLEAGUE], operator: [REP] }, REQUESTER, all);
    expect(cells).toEqual(
      expect.arrayContaining([
        { recipientKind: 'customer', recipientId: REQUESTER, channel: 'customer_email' },
        { recipientKind: 'customer', recipientId: COLLEAGUE, channel: 'customer_email' },
        { recipientKind: 'customer', recipientId: COLLEAGUE, channel: 'customer_in_app' },
        { recipientKind: 'customer', recipientId: COLLEAGUE, channel: 'customer_push' },
        { recipientKind: 'admin', recipientId: REP, channel: 'admin_in_app' },
        { recipientKind: 'admin', recipientId: REP, channel: 'admin_email' },
      ]),
    );
    expect(cells).toHaveLength(6);
    expect(cells.filter((c) => c.recipientId === REQUESTER).map((c) => c.channel)).toEqual(['customer_email']);
  });

  it('an operator’s approval tells the customer side on every channel, the actor rule not applying, and no operator', () => {
    const cells = plannedNotifications('approved', { customer: [REQUESTER], operator: [REP] }, null, all);
    expect(cells.map((c) => c.channel).sort()).toEqual(['customer_email', 'customer_in_app', 'customer_push']);
  });

  it('an offer accepted: operators on the bell only', () => {
    const cells = plannedNotifications('offer_accepted', { customer: [REQUESTER], operator: [REP] }, REQUESTER, all);
    expect(cells.filter((c) => c.recipientKind === 'admin')).toEqual([
      { recipientKind: 'admin', recipientId: REP, channel: 'admin_in_app' },
    ]);
  });

  it('one person, one record per channel (rule 1)', () => {
    const cells = plannedNotifications('expired', { customer: [REQUESTER, REQUESTER], operator: [REP, REP, OTHER_REP] }, null, all);
    expect(cells.filter((c) => c.recipientId === REQUESTER && c.channel === 'customer_email')).toHaveLength(1);
    expect(cells.filter((c) => c.channel === 'admin_in_app').map((c) => c.recipientId)).toEqual([REP, OTHER_REP]);
  });

  it('only the channels it is given', () => {
    const cells = plannedNotifications('approved', { customer: [REQUESTER], operator: [] }, null, ['customer_email']);
    expect(cells).toEqual([{ recipientKind: 'customer', recipientId: REQUESTER, channel: 'customer_email' }]);
  });
});

describe('RfqNotificationService.record', () => {
  it('persists one pending row per recorded cell into the caller’s EntityManager, and flushes it', async () => {
    const r = rig({ customer: [REQUESTER], operator: [REP, OTHER_REP] });
    const written = await r.service.record(r.em, {
      change: 'submitted',
      sourceEvent: event('submitted'),
      rfq,
      actor: { customerAccountId: REQUESTER },
    });
    expect(written).toBe(5);
    expect(r.within.flush).toHaveBeenCalledTimes(1);
    expect(r.persisted.map((row) => `${row.recipientKind}:${row.recipientId}:${row.channel}`).sort()).toEqual(
      [
        `admin:${OTHER_REP}:admin_email`,
        `admin:${OTHER_REP}:admin_in_app`,
        `admin:${REP}:admin_email`,
        `admin:${REP}:admin_in_app`,
        `customer:${REQUESTER}:customer_email`,
      ].sort(),
    );
    for (const row of r.persisted) {
      expect(row).toMatchObject({
        organizationId: ORG,
        quoteRequestId: RFQ,
        sourceEventId: EVENT,
        change: 'submitted',
        status: 'pending',
        attempts: 0,
        lastError: null,
        closedAt: null,
        sourceOccurredAt: OCCURRED,
      });
    }
  });

  it('does not ask for the operator side when the change tells no operator', async () => {
    const r = rig();
    await r.service.record(r.em, { change: 'revised', sourceEvent: event('modified'), rfq, actor: null });
    expect(r.recipients.operatorSide).not.toHaveBeenCalled();
    expect(r.persisted.map((row) => row.channel)).toEqual(['customer_email']);
  });

  it('records nothing, and does not flush, when nobody is to be told', async () => {
    const r = rig({ customer: [], operator: [] });
    const written = await r.service.record(r.em, {
      change: 'expired',
      sourceEvent: event('expired'),
      rfq,
      actor: null,
    });
    expect(written).toBe(0);
    expect(r.within.flush).not.toHaveBeenCalled();
  });

  it('refuses a source history entry that is not the one the matrix names for the change', async () => {
    const r = rig();
    await expect(
      r.service.record(r.em, { change: 'prepared', sourceEvent: event('note-added'), rfq, actor: null }),
    ).rejects.toThrow(/prepared.*note-added/);
    await expect(
      r.service.record(r.em, {
        change: 'approved',
        sourceEvent: event('approved', { approvedBy: 'customer' }),
        rfq,
        actor: null,
      }),
    ).rejects.toThrow(/approvedBy/);
    expect(r.persisted).toEqual([]);
  });
});
