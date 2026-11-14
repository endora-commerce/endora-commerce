import type { QuoteRequestEventType } from '../../entities/quote-request-event.entity.js';

/**
 * Who is told about a quote request change, through which channel —
 * `specs/179-rfq-and-customer-notifications/contracts/notification-matrix.md`
 * §1 as data. The recording step reads this and nothing else decides
 * recipients; `notification-matrix.test.ts` holds it equal to the contract.
 *
 * Adding a transition (for example `specs/170-organization-roles/` P3's
 * internal approval) is adding a row to the contract and one here.
 *
 * A completed request has no row: the order confirmation covers it.
 */
export const NOTIFICATION_CHANGES = [
  'submitted',
  'resubmitted',
  'offer_accepted',
  'offer_rejected',
  'expired',
  'prepared',
  'revised',
  'approved',
  'canceled',
] as const;

export type QuoteRequestNotificationChange = (typeof NOTIFICATION_CHANGES)[number];

export const NOTIFICATION_CHANNELS = [
  'customer_email',
  'customer_in_app',
  'customer_push',
  'admin_in_app',
  'admin_email',
] as const;

export type QuoteRequestNotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** `admin` = an `admin_users` id, `customer` = a `customer_accounts` id. */
export type NotificationRecipientKind = 'admin' | 'customer';

/**
 * One matrix cell: `customer` = the customer side (research R-3),
 * `customer_except_actor` = the customer side without the account whose action
 * caused the change (rule 3), `operator` = the operator side (research R-5),
 * `null` = nobody.
 */
export type NotificationAudience = 'customer' | 'customer_except_actor' | 'operator' | null;

export interface NotificationMatrixRow {
  /** The `event_type` of the history entry the records announce (rule 5). */
  readonly sourceEventType: QuoteRequestEventType;
  /** Payload fields that tell two changes sharing one `event_type` apart. */
  readonly sourceDiscriminator?: Readonly<Record<string, string>>;
  readonly channels: Readonly<Record<QuoteRequestNotificationChannel, NotificationAudience>>;
}

const C = 'customer';
const CA = 'customer_except_actor';
const O = 'operator';

function row(
  sourceEventType: QuoteRequestEventType,
  sourceDiscriminator: Record<string, string> | null,
  [customerEmail, customerInApp, customerPush, adminInApp, adminEmail]: readonly NotificationAudience[],
): NotificationMatrixRow {
  return {
    sourceEventType,
    ...(sourceDiscriminator ? { sourceDiscriminator } : {}),
    channels: {
      customer_email: customerEmail ?? null,
      customer_in_app: customerInApp ?? null,
      customer_push: customerPush ?? null,
      admin_in_app: adminInApp ?? null,
      admin_email: adminEmail ?? null,
    },
  };
}

/** Cells in the contract's column order: customer e-mail, customer in-app, push, admin bell, admin e-mail. */
export const NOTIFICATION_MATRIX: Readonly<Record<QuoteRequestNotificationChange, NotificationMatrixRow>> = {
  submitted: row('submitted', null, [C, CA, CA, O, O]),
  resubmitted: row('re-submitted', null, [C, CA, CA, O, O]),
  offer_accepted: row('approved', { approvedBy: 'customer' }, [C, CA, CA, O, null]),
  offer_rejected: row('canceled', { canceledBy: 'customer' }, [C, CA, CA, O, null]),
  expired: row('expired', null, [C, C, C, O, null]),
  prepared: row('created', null, [C, C, C, null, null]),
  revised: row('modified', null, [C, C, C, null, null]),
  approved: row('approved', { approvedBy: 'admin' }, [C, C, C, null, null]),
  canceled: row('canceled', { canceledBy: 'admin' }, [C, C, C, null, null]),
};

/**
 * The channels the recording step writes today. A record is only worth writing
 * for a channel something will deliver: `customer_in_app` joined with the
 * customer notification centre (`specs/179-…` WP-08); `customer_push` joins
 * with the PWA port (WP-10), and until then its matrix cells stand and write
 * nothing.
 *
 * A channel is recorded whether or not its owner is on when the change
 * commits: presence is the delivery's question, asked when the worker reaches
 * the record, which closes `skipped_module_off` if the owner is off then
 * (FR-012). The record is what the History shows the operator.
 */
export const RECORDED_CHANNELS: readonly QuoteRequestNotificationChannel[] = [
  'customer_email',
  'customer_in_app',
  'admin_in_app',
  'admin_email',
];

/** The side a channel belongs to — the table's `channel_side` check constraint, as code. */
export function channelSide(channel: QuoteRequestNotificationChannel): NotificationRecipientKind {
  return channel.startsWith('admin_') ? 'admin' : 'customer';
}
