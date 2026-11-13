import { ERROR_CODES, type CustomerNotification as CustomerNotificationDto, type SupportedLanguage } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type {
  CustomerNotification,
  StoredCustomerNotificationMessage,
} from '../entities/customer-notification.entity.js';

/**
 * The storefront half of the centre
 * (`specs/179-rfq-and-customer-notifications/contracts/customer-notifications-storefront-api.md`,
 * FR-042 – FR-045).
 *
 * Every read and every mark goes through one {@link NotificationVisibility} —
 * the reader's own account, the request's resolved channel or no channel
 * (Principle XII), and the producers that are effectively present
 * (Principle XVII, research R-14) — handed to the store, which applies it in
 * the query and not after it. *Mark all as read* therefore marks exactly what
 * the list shows: an entry hidden on this channel stays unread for the channel
 * it belongs to.
 *
 * Entries are translated on read, in the request's language, through `_i18n`
 * (research R-13); the stored English sentence is the answer when the key does
 * not resolve. Under impersonation the reads are answered and the marks write
 * nothing (FR-045).
 */

/** Who is reading, as the route resolved it from the request. */
export interface NotificationReader {
  readonly customerAccountId: string;
  readonly organizationId: string | null;
  /** The request's resolved sales channel. */
  readonly salesChannelId: string;
  readonly language: SupportedLanguage;
  /** A Supplier employee acting on the buyer's behalf (FR-045). */
  readonly impersonating: boolean;
}

/** The three predicates every read and every mark applies, in the query. */
export interface NotificationVisibility {
  readonly customerAccountId: string;
  /** Entries of this channel, and entries of no channel. */
  readonly salesChannelId: string;
  /** Entries whose producing module is effectively present. Never empty when handed to the store. */
  readonly sourceModules: readonly string[];
}

/** A keyset position: the entry after which the next page starts, in `(created_at desc, id desc)` order. */
export interface NotificationPosition {
  readonly createdAt: Date;
  readonly id: string;
}

export interface CustomerNotificationStore {
  /** Newest first, `(created_at desc, id desc)`, strictly after `after` when given, at most `limit` rows. */
  list(
    visibility: NotificationVisibility,
    page: { readonly limit: number; readonly after: NotificationPosition | null },
  ): Promise<CustomerNotification[]>;
  /** The entry with this id when it is visible, otherwise `null`. */
  findVisible(visibility: NotificationVisibility, id: string): Promise<CustomerNotification | null>;
  countUnread(visibility: NotificationVisibility): Promise<number>;
  /** Marks the entry read at `at` unless it already is. Answers whether the entry is visible at all. */
  markRead(visibility: NotificationVisibility, id: string, at: Date): Promise<boolean>;
  /** Marks every visible unread entry read at `at`. Answers how many changed. */
  markAllRead(visibility: NotificationVisibility, at: Date): Promise<number>;
}

/** `_i18n`'s `translate`: the template, or `<scope>.<key>` when no bundle holds the key. */
export type TranslateMessage = (
  scope: string,
  key: string,
  language: SupportedLanguage,
  params?: Record<string, string | number>,
) => Promise<string>;

export interface CustomerNotificationServiceDeps {
  readonly store: CustomerNotificationStore;
  readonly translate: TranslateMessage;
  /** The ids of the modules effectively present right now. */
  readonly presentModules: () => readonly string[];
  readonly now?: () => Date;
}

export interface CustomerNotificationPage {
  items: CustomerNotificationDto[];
  nextCursor: string | null;
  unreadCount: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class CustomerNotificationService {
  constructor(private readonly deps: CustomerNotificationServiceDeps) {}

  async list(
    reader: NotificationReader,
    page: { readonly limit: number; readonly cursor: string | null },
  ): Promise<CustomerNotificationPage> {
    const after = page.cursor === null ? null : decodeCursorOrRefuse(page.cursor);
    const visibility = this.#visibility(reader);
    if (visibility === null) return { items: [], nextCursor: null, unreadCount: 0 };

    const [rows, unreadCount] = await Promise.all([
      this.deps.store.list(visibility, { limit: page.limit + 1, after }),
      this.deps.store.countUnread(visibility),
    ]);
    const shown = rows.slice(0, page.limit);
    const last = shown[shown.length - 1];
    const nextCursor =
      rows.length > page.limit && last !== undefined ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
    const items = await Promise.all(shown.map((row) => this.#render(row, reader.language)));
    return { items, nextCursor, unreadCount };
  }

  /**
   * One entry, as the list would render it. Read-only: it marks nothing, so it
   * answers the same under impersonation.
   */
  async get(reader: NotificationReader, id: string): Promise<CustomerNotificationDto> {
    // An id that is not a uuid names no entry; answered like one that is not the caller's.
    if (!UUID_RE.test(id)) throw notFound();
    const visibility = this.#visibility(reader);
    if (visibility === null) throw notFound();
    const row = await this.deps.store.findVisible(visibility, id);
    if (row === null) throw notFound();
    return this.#render(row, reader.language);
  }

  async unreadCount(reader: NotificationReader): Promise<number> {
    const visibility = this.#visibility(reader);
    if (visibility === null) return 0;
    return this.deps.store.countUnread(visibility);
  }

  async markRead(reader: NotificationReader, id: string): Promise<void> {
    // An id that is not a uuid names no entry; it is answered like one that is
    // not the caller's, rather than as a malformed request.
    if (!UUID_RE.test(id)) throw notFound();
    // FR-045 — answered as if it succeeded, and nothing is written.
    if (reader.impersonating) return;
    const visibility = this.#visibility(reader);
    if (visibility === null) throw notFound();
    const visible = await this.deps.store.markRead(visibility, id, this.#now());
    if (!visible) throw notFound();
  }

  async markAllRead(reader: NotificationReader): Promise<{ updated: number }> {
    if (reader.impersonating) return { updated: 0 };
    const visibility = this.#visibility(reader);
    if (visibility === null) return { updated: 0 };
    return { updated: await this.deps.store.markAllRead(visibility, this.#now()) };
  }

  #now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** `null` when no producer is present: there is nothing the reader may see. */
  #visibility(reader: NotificationReader): NotificationVisibility | null {
    const sourceModules = [...this.deps.presentModules()];
    if (sourceModules.length === 0) return null;
    return {
      customerAccountId: reader.customerAccountId,
      salesChannelId: reader.salesChannelId,
      sourceModules,
    };
  }

  async #render(row: CustomerNotification, language: SupportedLanguage): Promise<CustomerNotificationDto> {
    const title = await this.#translated(row.titleMessage, row.title, language);
    const body =
      row.body === null || row.body === undefined
        ? null
        : row.bodyMessage
          ? await this.#translated(row.bodyMessage, row.body, language)
          : row.body;
    return {
      id: row.id,
      kind: row.kind,
      title,
      body,
      subject:
        row.subjectType && row.subjectId ? { type: row.subjectType, id: row.subjectId } : null,
      linkPath: row.linkPath ?? null,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    };
  }

  async #translated(
    message: StoredCustomerNotificationMessage,
    fallback: string,
    language: SupportedLanguage,
  ): Promise<string> {
    const answer = await this.deps.translate(message.scope, message.key, language, message.params);
    // `_i18n` answers the `<scope>.<key>` placeholder for a key no bundle holds,
    // after its own English rung; the stored sentence is better than a key.
    return answer === `${message.scope}.${message.key}` ? fallback : answer;
  }
}

function notFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Notification not found.');
}

/** The opaque cursor: base64url of `{ "c": <ISO created_at>, "i": <id> }`. */
export function encodeCursor(position: NotificationPosition): string {
  return Buffer.from(JSON.stringify({ c: position.createdAt.toISOString(), i: position.id }), 'utf8').toString(
    'base64url',
  );
}

/** The position a cursor names, or `null` for a string that is not one. */
export function decodeCursor(cursor: string): NotificationPosition | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { c, i } = parsed as { c?: unknown; i?: unknown };
    if (typeof c !== 'string' || typeof i !== 'string' || !UUID_RE.test(i)) return null;
    const createdAt = new Date(c);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: i };
  } catch {
    return null;
  }
}

function decodeCursorOrRefuse(cursor: string): NotificationPosition {
  const position = decodeCursor(cursor);
  if (position === null) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this API issued.', [
      { path: 'cursor', issue: 'Expected a cursor from a previous page' },
    ]);
  }
  return position;
}
