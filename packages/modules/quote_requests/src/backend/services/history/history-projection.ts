/**
 * Feature 146 (FR-010 – FR-019; research R8; contract
 * `admin-quote-request-api.md` §3, rules H1 – H3) — the admin History read
 * model.
 *
 * Pure: the stored events, the revisions they reference (plus each
 * modification's predecessor) and three lookup directories in, structured
 * entries out. The backend composes no prose here — it returns kind codes and
 * values, and the admin renders them from its own bundle.
 *
 * Threat model T9: the directories are built by explicit mappers that copy the
 * fields the response needs and nothing else — an admin's first and last name,
 * a customer's name and e-mail — so a field added to either record later does
 * not reach the response.
 */
import {
  customFieldCarrySkipRecord,
  customFieldCarrySkipSchema,
  quoteRequestHistoryChangeSchema,
  uuidSchema,
  type AdminUserRecord,
  type CatalogProductVariantRecord,
  type CustomerAccountRecord,
  type QuoteRequestHistoryActor,
  type QuoteRequestHistoryChange,
  type QuoteRequestHistoryEntry,
  type QuoteRequestHistoryEntryKind,
  isUuidShape,
} from '@endora-commerce/contracts';
import type { QuoteRequestEventType } from '../../entities/quote-request-event.entity.js';
import type { QuoteRequestRevisionLine } from '../../entities/quote-request-revision.entity.js';
import { AUTOMATIC_ADMIN_CREATION_NOTE } from './constants.js';
import { historyDiff } from './history-diff.js';

/** The part of a stored event the projection reads. */
export interface HistoryEventInput {
  id: string;
  eventType: QuoteRequestEventType;
  actorAdminUserId: string | null;
  actorCustomerAccountId: string | null;
  actorRoleLabel: string | null;
  payload: Record<string, unknown>;
  revisionId: string | null;
  createdAt: Date;
}

/** The part of a stored revision the projection reads. */
export interface HistoryRevisionInput {
  id: string;
  revisionNumber: number;
  previousRevisionId: string | null;
  headerNoteSnapshot: string | null;
  itemsSnapshot: QuoteRequestRevisionLine[];
}

export interface AdminActorName {
  name: string | null;
}

export interface CustomerActorName {
  name: string | null;
  email: string | null;
}

export interface HistoryDirectory {
  admins: ReadonlyMap<string, AdminActorName>;
  customers: ReadonlyMap<string, CustomerActorName>;
  /** Variant id → label; a variant missing here is labelled `null`. */
  variantLabels: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Directories — the explicit mappers (T9)
// ---------------------------------------------------------------------------

/** First and last name only — never e-mail, last login, 2FA or status. */
export function adminActorDirectory(records: readonly AdminUserRecord[]): Map<string, AdminActorName> {
  return new Map(records.map((record) => [record.id, { name: fullName(record.firstName, record.lastName) }]));
}

/** Name and e-mail only (FR-017). */
export function customerActorDirectory(
  records: readonly CustomerAccountRecord[],
): Map<string, CustomerActorName> {
  return new Map(
    records.map((record) => [
      record.id,
      { name: fullName(record.firstName, record.lastName), email: record.email ?? null },
    ]),
  );
}

/**
 * A variant's label: its attribute values as the catalogue editor shows them
 * (`key=value`, comma-separated), else its SKU.
 */
export function variantLabelDirectory(
  records: readonly CatalogProductVariantRecord[],
): Map<string, string> {
  return new Map(
    records.map((record) => {
      const values = Object.entries(record.variantAttributeValues ?? {})
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(', ');
      return [record.id, values || record.sku];
    }),
  );
}

// ---------------------------------------------------------------------------
// Bounded revision reads
// ---------------------------------------------------------------------------

/**
 * What still has to be read so every modification in the window can be
 * diffed: the predecessor of each modification's revision — by its link, else
 * by number − 1 — unless it is already loaded. Nothing else.
 */
export function predecessorsToRead(
  events: readonly HistoryEventInput[],
  loaded: readonly HistoryRevisionInput[],
): { ids: string[]; numbers: number[] } {
  const byId = new Map(loaded.map((revision) => [revision.id, revision]));
  const loadedNumbers = new Set(loaded.map((revision) => revision.revisionNumber));
  const ids: string[] = [];
  const numbers: number[] = [];
  for (const event of events) {
    if (event.eventType !== 'modified' || event.revisionId === null) continue;
    const revision = byId.get(event.revisionId);
    if (!revision) continue;
    if (revision.previousRevisionId) {
      if (!byId.has(revision.previousRevisionId) && !ids.includes(revision.previousRevisionId)) {
        ids.push(revision.previousRevisionId);
      }
      continue;
    }
    const previous = revision.revisionNumber - 1;
    if (previous >= 1 && !loadedNumbers.has(previous) && !numbers.includes(previous)) {
      numbers.push(previous);
    }
  }
  return { ids, numbers };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Order of events written in one call when their timestamps tie: the first
 * half of every pair sorts before the second.
 */
const WRITE_ORDER: Partial<Record<QuoteRequestEventType, number>> = {
  created: 0,
  'customer-accepted-revision': 0,
  'customer-rejected-revision': 0,
  'note-added': 1,
};

export function projectHistory(
  events: readonly HistoryEventInput[],
  revisions: readonly HistoryRevisionInput[],
  directory: HistoryDirectory,
): QuoteRequestHistoryEntry[] {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        a.event.createdAt.getTime() - b.event.createdAt.getTime() ||
        (WRITE_ORDER[a.event.eventType] ?? 2) - (WRITE_ORDER[b.event.eventType] ?? 2) ||
        a.index - b.index,
    )
    .map(({ event }) => event);

  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const revisionByNumber = new Map(revisions.map((revision) => [revision.revisionNumber, revision]));

  const entries: QuoteRequestHistoryEntry[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const first = ordered[index]!;
    const next = ordered[index + 1];
    const pairKind = next && sameActor(first, next) ? pairedKind(first, next) : null;
    const group = pairKind !== null ? [first, next!] : [first];
    if (pairKind !== null) index += 1;
    entries.push(
      toEntry(group, pairKind ?? singleKind(first), { revisionById, revisionByNumber, directory }),
    );
  }
  return entries;
}

interface ProjectionContext {
  revisionById: ReadonlyMap<string, HistoryRevisionInput>;
  revisionByNumber: ReadonlyMap<number, HistoryRevisionInput>;
  directory: HistoryDirectory;
}

/** Research R8's pairing table; `null` = the two do not merge. */
function pairedKind(first: HistoryEventInput, second: HistoryEventInput): QuoteRequestHistoryEntryKind | null {
  const a = first.eventType;
  const b = second.eventType;
  if (a === 'created' && b === 'submitted' && !hasSource(first)) return 'submitted';
  if (a === 'created' && b === 're-submitted' && hasSource(first)) return 'resubmitted';
  if (
    a === 'created' &&
    b === 'note-added' &&
    first.actorAdminUserId !== null &&
    second.payload['note'] === AUTOMATIC_ADMIN_CREATION_NOTE
  ) {
    return 'created_by_admin';
  }
  if (a === 'customer-accepted-revision' && b === 'approved') return 'accepted_by_customer';
  if (a === 'customer-rejected-revision' && b === 'canceled') return 'rejected_by_customer';
  if (a === 'note-added' && b === 'approved' && first.actorAdminUserId !== null) return 'approved';
  return null;
}

function singleKind(event: HistoryEventInput): QuoteRequestHistoryEntryKind {
  switch (event.eventType) {
    case 'created':
      return 'created';
    case 'submitted':
      return 'submitted';
    case 're-submitted':
      return 'resubmitted';
    case 'modified':
      return 'modified';
    case 'approved':
      return 'approved';
    case 'canceled':
      return 'canceled';
    case 'expired':
      return 'expired';
    case 'completed':
      return 'completed';
    case 'customer-accepted-revision':
      return 'accepted_by_customer';
    case 'customer-rejected-revision':
      return 'rejected_by_customer';
    case 'note-added':
      return 'note_added';
    case 'pdf-sent':
      return 'pdf_sent';
    case 'custom-field-carry-skipped':
      return 'custom_field_carry_skipped';
  }
}

function toEntry(
  group: HistoryEventInput[],
  kind: QuoteRequestHistoryEntryKind,
  ctx: ProjectionContext,
): QuoteRequestHistoryEntry {
  const first = group[0]!;
  return {
    id: first.id,
    eventIds: group.map((event) => event.id),
    kind,
    occurredAt: first.createdAt.toISOString(),
    actor: actorOf(first, ctx.directory),
    revisionNumber: revisionNumberOf(group, ctx),
    note: kind === 'approved' || kind === 'note_added' ? noteOf(group) : null,
    reason:
      kind === 'canceled' || kind === 'rejected_by_customer' ? firstString(group, 'reason') : null,
    changes: kind === 'modified' ? changesOf(first, ctx) : null,
    relatedQuoteRequestId:
      kind === 'resubmitted' || kind === 'created' || kind === 'submitted'
        ? firstUuid(group, 'sourceRfqId')
        : null,
    orderId: kind === 'completed' ? firstUuid(group, 'orderId') : null,
    delivery: kind === 'pdf_sent' ? deliveryOf(first) : null,
    customFieldCarry: kind === 'custom_field_carry_skipped' ? customFieldCarryOf(first) : null,
  };
}

/**
 * Feature 162 — the Sales Opportunity a value came from and every key not
 * carried, with its reason. Read field by field, as `deliveryOf` reads its
 * payload: a skip that is not well formed is left out, and a source that is
 * not one — or nothing left to name — reads as none.
 */
function customFieldCarryOf(event: HistoryEventInput): QuoteRequestHistoryEntry['customFieldCarry'] {
  const source = event.payload['source'];
  if (typeof source !== 'object' || source === null) return null;
  const { entityType, recordId, reference } = source as Record<string, unknown>;
  if (
    entityType !== 'opportunity' ||
    !uuidSchema.safeParse(recordId).success ||
    typeof reference !== 'string'
  ) {
    return null;
  }
  const raw = Array.isArray(event.payload['skipped']) ? (event.payload['skipped'] as unknown[]) : [];
  const skipped = raw.flatMap((item) => {
    const parsed = customFieldCarrySkipSchema.safeParse(item);
    return parsed.success ? [customFieldCarrySkipRecord(parsed.data)] : [];
  });
  if (skipped.length === 0) return null;
  return { source: { entityType, recordId: recordId as string, reference }, skipped };
}

/**
 * Feature 153 (owner answer Q4) — who the quote PDF was e-mailed to, with which
 * template and in which language. Read field by field: a stored payload is
 * untrusted, and a value of the wrong type is left out rather than echoed.
 */
function deliveryOf(event: HistoryEventInput): NonNullable<QuoteRequestHistoryEntry['delivery']> {
  const payload = event.payload;
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
  const recipients = Array.isArray(payload['recipients'])
    ? (payload['recipients'] as unknown[]).filter((value): value is string => typeof value === 'string' && value !== '')
    : [];
  return {
    recipients,
    templateName: text(payload['templateName']),
    language: text(payload['language']),
    message: text(payload['message']),
  };
}

/** H2 — the acting party, never the requester. */
function actorOf(event: HistoryEventInput, directory: HistoryDirectory): QuoteRequestHistoryActor {
  const recordedRole = event.actorRoleLabel ?? null;
  if (event.actorAdminUserId) {
    return {
      kind: 'admin',
      adminUserId: event.actorAdminUserId,
      name: directory.admins.get(event.actorAdminUserId)?.name ?? null,
      recordedRole,
    };
  }
  if (event.actorCustomerAccountId) {
    const customer = directory.customers.get(event.actorCustomerAccountId);
    return {
      kind: 'customer',
      customerAccountId: event.actorCustomerAccountId,
      name: customer?.name ?? null,
      email: customer?.email ?? null,
      recordedRole,
    };
  }
  if (recordedRole === 'System') return { kind: 'system' };
  return { kind: 'unknown', recordedRole };
}

function revisionNumberOf(group: HistoryEventInput[], ctx: ProjectionContext): number | null {
  for (const event of group) {
    const revision = event.revisionId ? ctx.revisionById.get(event.revisionId) : undefined;
    if (revision) return revision.revisionNumber;
  }
  for (const event of group) {
    const value = event.payload['revisionNumber'];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

/** The typed note of an entry — never the automatic creation sentence. */
function noteOf(group: HistoryEventInput[]): string | null {
  const note = firstString(group, 'note');
  return note === AUTOMATIC_ADMIN_CREATION_NOTE ? null : note;
}

/** H3 — the diff against the previous revision, plus the validity change of the payload. */
function changesOf(event: HistoryEventInput, ctx: ProjectionContext): QuoteRequestHistoryChange[] {
  const changes: QuoteRequestHistoryChange[] = [];
  const revision = event.revisionId ? ctx.revisionById.get(event.revisionId) : undefined;
  if (revision) {
    const previous = revision.previousRevisionId
      ? ctx.revisionById.get(revision.previousRevisionId)
      : ctx.revisionByNumber.get(revision.revisionNumber - 1);
    if (previous) {
      changes.push(
        ...historyDiff(
          { headerNote: previous.headerNoteSnapshot ?? null, items: previous.itemsSnapshot ?? [] },
          { headerNote: revision.headerNoteSnapshot ?? null, items: revision.itemsSnapshot ?? [] },
          ctx.directory.variantLabels,
        ),
      );
    }
  }
  const validity = event.payload['validity'];
  if (validity !== null && typeof validity === 'object') {
    const { before, after } = validity as Record<string, unknown>;
    const parsed = quoteRequestHistoryChangeSchema.safeParse({ kind: 'validity', before, after });
    if (parsed.success) changes.push(parsed.data);
  }
  return changes;
}

function sameActor(a: HistoryEventInput, b: HistoryEventInput): boolean {
  return (
    (a.actorAdminUserId ?? null) === (b.actorAdminUserId ?? null) &&
    (a.actorCustomerAccountId ?? null) === (b.actorCustomerAccountId ?? null)
  );
}

function hasSource(event: HistoryEventInput): boolean {
  return typeof event.payload['sourceRfqId'] === 'string';
}

function firstString(group: HistoryEventInput[], key: string): string | null {
  for (const event of group) {
    const value = event.payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function firstUuid(group: HistoryEventInput[], key: string): string | null {
  const value = firstString(group, key);
  return value !== null && isUuidShape(value) ? value : null;
}

function fullName(firstName: string | null | undefined, lastName: string | null | undefined): string | null {
  const name = [firstName, lastName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
  return name.length > 0 ? name : null;
}
