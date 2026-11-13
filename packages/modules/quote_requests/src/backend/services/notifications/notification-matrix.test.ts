import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CHANGES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_MATRIX,
  RECORDED_CHANNELS,
  channelSide,
  type NotificationAudience,
  type QuoteRequestNotificationChange,
  type QuoteRequestNotificationChannel,
} from './notification-matrix.js';

/**
 * `specs/179-rfq-and-customer-notifications/` T011 — `notification-matrix.ts`
 * is `contracts/notification-matrix.md` §1 as data, and nothing else decides
 * who is told. The table below is that section transcribed cell by cell:
 * `C` = the customer side, `C − actor` = the customer side without the account
 * whose action caused the change, `O` = the operator side, `—` = nobody.
 *
 * A change to who is told is a change to the contract first and to both
 * tables second; this test is what keeps the two from drifting.
 */
const C = 'customer';
const CA = 'customer_except_actor';
const O = 'operator';
const NONE = null;

type Row = [
  change: QuoteRequestNotificationChange,
  sourceEventType: string,
  sourceDiscriminator: Record<string, string> | null,
  customerEmail: NotificationAudience,
  customerInApp: NotificationAudience,
  customerPush: NotificationAudience,
  adminInApp: NotificationAudience,
  adminEmail: NotificationAudience,
];

const CONTRACT: Row[] = [
  ['submitted', 'submitted', null, C, CA, CA, O, O],
  ['resubmitted', 're-submitted', null, C, CA, CA, O, O],
  ['offer_accepted', 'approved', { approvedBy: 'customer' }, C, CA, CA, O, NONE],
  ['offer_rejected', 'canceled', { canceledBy: 'customer' }, C, CA, CA, O, NONE],
  ['expired', 'expired', null, C, C, C, O, NONE],
  ['prepared', 'created', null, C, C, C, NONE, NONE],
  ['revised', 'modified', null, C, C, C, NONE, NONE],
  ['approved', 'approved', { approvedBy: 'admin' }, C, C, C, NONE, NONE],
  ['canceled', 'canceled', { canceledBy: 'admin' }, C, C, C, NONE, NONE],
];

describe('the quote request notification matrix (contracts/notification-matrix.md §1)', () => {
  it('has exactly the contract’s rows, in its order — and no row for a completed request', () => {
    expect([...NOTIFICATION_CHANGES]).toEqual(CONTRACT.map(([change]) => change));
    expect(Object.keys(NOTIFICATION_MATRIX).sort()).toEqual([...NOTIFICATION_CHANGES].sort());
    expect(NOTIFICATION_CHANGES).not.toContain('completed');
  });

  it('has exactly the contract’s five channels', () => {
    expect([...NOTIFICATION_CHANNELS].sort()).toEqual(
      ['admin_email', 'admin_in_app', 'customer_email', 'customer_in_app', 'customer_push'].sort(),
    );
  });

  it.each(CONTRACT)(
    '%s — source history entry and every channel cell',
    (change, sourceEventType, sourceDiscriminator, customerEmail, customerInApp, customerPush, adminInApp, adminEmail) => {
      const row = NOTIFICATION_MATRIX[change];
      expect(row.sourceEventType).toBe(sourceEventType);
      expect(row.sourceDiscriminator ?? null).toEqual(sourceDiscriminator);
      const expected: Record<QuoteRequestNotificationChannel, NotificationAudience> = {
        customer_email: customerEmail,
        customer_in_app: customerInApp,
        customer_push: customerPush,
        admin_in_app: adminInApp,
        admin_email: adminEmail,
      };
      expect(row.channels).toEqual(expected);
    },
  );

  it('the actor rule: the actor keeps the e-mail and loses only in-app and push (rule 3)', () => {
    for (const change of NOTIFICATION_CHANGES) {
      const { channels } = NOTIFICATION_MATRIX[change];
      expect(channels.customer_email, change).not.toBe(CA);
      for (const channel of NOTIFICATION_CHANNELS) {
        if (channels[channel] === CA) expect(['customer_in_app', 'customer_push']).toContain(channel);
      }
    }
  });

  it('a customer audience only on a customer channel, the operator only on an admin channel', () => {
    for (const change of NOTIFICATION_CHANGES) {
      for (const channel of NOTIFICATION_CHANNELS) {
        const audience = NOTIFICATION_MATRIX[change].channels[channel];
        if (audience === null) continue;
        expect(channelSide(channel), `${change} × ${channel}`).toBe(audience === O ? 'admin' : 'customer');
      }
    }
  });

  it('records only the channels a delivery adapter will exist for in this phase', () => {
    // `customer_in_app` joins with `specs/179-…` WP-08, `customer_push` with WP-10:
    // a record nobody can deliver would only ever close as stale.
    expect([...RECORDED_CHANNELS].sort()).toEqual(['admin_email', 'admin_in_app', 'customer_email']);
  });
});
