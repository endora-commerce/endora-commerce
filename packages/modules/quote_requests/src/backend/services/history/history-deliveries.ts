/**
 * `specs/179-rfq-and-customer-notifications/` WP-06 (FR-070; contract
 * `delivery-and-ports.md` §4) — the notification delivery records a History
 * entry lists.
 *
 * Pure: the `quote_request_notifications` rows of the window's events and the
 * History's own name directories in, contract deliveries out, grouped by the
 * event each record announces. `projectHistory` attaches them to the entry
 * whose `eventIds` holds that event.
 *
 * A recipient is named from the same directories the actors are (threat model
 * T9): an administrator by first and last name, a customer by name, else by
 * the e-mail the History already shows for a customer actor. A person the
 * directory does not hold — a deleted or anonymised account, an administrator
 * removed — is named `''`, which the screen renders as "unknown user".
 */
import type { QuoteRequestDelivery } from '@endora-commerce/contracts';
import type { QuoteRequestNotificationStatus } from '../../entities/quote-request-notification.entity.js';
import {
  NOTIFICATION_CHANNELS,
  type NotificationRecipientKind,
  type QuoteRequestNotificationChannel,
} from '../notifications/notification-matrix.js';
import type { AdminActorName, CustomerActorName } from './history-projection.js';

/** The part of a delivery record the History reads. */
export interface HistoryDeliveryInput {
  id: string;
  sourceEventId: string;
  recipientKind: NotificationRecipientKind;
  recipientId: string;
  channel: QuoteRequestNotificationChannel;
  status: QuoteRequestNotificationStatus;
  attempts: number;
  lastError: string | null;
  closedAt: Date | null;
}

export interface DeliveryRecipientDirectory {
  admins: ReadonlyMap<string, AdminActorName>;
  customers: ReadonlyMap<string, CustomerActorName>;
}

/** Event id → its deliveries, each list in display order. */
export function deliveriesByEvent(
  records: readonly HistoryDeliveryInput[],
  directory: DeliveryRecipientDirectory,
): Map<string, QuoteRequestDelivery[]> {
  const byEvent = new Map<string, QuoteRequestDelivery[]>();
  for (const record of records) {
    const list = byEvent.get(record.sourceEventId) ?? [];
    list.push(toDelivery(record, directory));
    byEvent.set(record.sourceEventId, list);
  }
  for (const list of byEvent.values()) list.sort(compareDeliveries);
  return byEvent;
}

/**
 * Display order: the customer side before the operators, then by name, then
 * by the matrix's channel order — so one person's channels sit together.
 */
export function compareDeliveries(a: QuoteRequestDelivery, b: QuoteRequestDelivery): number {
  return (
    sideRank(a) - sideRank(b) ||
    a.recipient.displayName.localeCompare(b.recipient.displayName) ||
    a.recipient.id.localeCompare(b.recipient.id) ||
    channelRank(a) - channelRank(b) ||
    a.id.localeCompare(b.id)
  );
}

function toDelivery(record: HistoryDeliveryInput, directory: DeliveryRecipientDirectory): QuoteRequestDelivery {
  return {
    id: record.id,
    channel: record.channel,
    recipient: { kind: record.recipientKind, id: record.recipientId, displayName: displayName(record, directory) },
    status: record.status,
    attempts: record.attempts,
    lastError: record.lastError,
    closedAt: record.closedAt ? record.closedAt.toISOString() : null,
  };
}

function displayName(record: HistoryDeliveryInput, directory: DeliveryRecipientDirectory): string {
  if (record.recipientKind === 'admin') return directory.admins.get(record.recipientId)?.name ?? '';
  const customer = directory.customers.get(record.recipientId);
  return customer?.name ?? customer?.email ?? '';
}

function sideRank(delivery: QuoteRequestDelivery): number {
  return delivery.recipient.kind === 'customer' ? 0 : 1;
}

function channelRank(delivery: QuoteRequestDelivery): number {
  return NOTIFICATION_CHANNELS.indexOf(delivery.channel);
}
