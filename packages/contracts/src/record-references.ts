import { z } from 'zod';
import { UUID_SHAPE_PATTERN } from './common.js';
import { collectionEnvelope } from './envelopes.js';

/**
 * The reference standard of every record's free text — an Opportunity's, a
 * Project's, a Task's (`specs/163-projects-and-tasks/` research R-14, FR-044).
 *
 * Free text (a description, a note's or a message's body) is stored as plain
 * text carrying `[[<type>:<uuid>]]` tokens. This is the one place the grammar is
 * written; a backend extracts with it and an admin composer inserts with it.
 * What a person types to get one — `@` a person, `@@` a document (an Order, a
 * Quote Request, a Task, an Opportunity or a Project, in one grouped list),
 * `@@@` a Product — is the composer's and is never stored.
 *
 * The grammar was CRM's (`crm.ts` §9, three types) and moved here under neutral
 * names when Projects became its second user; CRM's exported names are aliases
 * of these, so a text CRM stored before reads exactly as it did — its tokens are
 * a subset of the seven.
 */

/**
 * What a free text can refer to. `admin_user` is a person — a user of the Admin
 * UI, under the name the platform has for one everywhere else; `user` alone
 * would also read as a customer.
 */
export const RECORD_REFERENCE_TYPES = [
  'product',
  'order',
  'admin_user',
  'quote_request',
  'task',
  // `specs/165-task-management/` research R-5 — platform-wide, so CRM's and
  // Projects' extractors recognise them too and their reference checks widen.
  'opportunity',
  'project',
] as const;
export const recordReferenceTypeSchema = z.enum(RECORD_REFERENCE_TYPES);
export type RecordReferenceType = z.infer<typeof recordReferenceTypeSchema>;

/**
 * The source of the token expression — group 1 the type, group 2 the id. A
 * source and not a shared `RegExp`, because a global expression carries
 * `lastIndex` from one caller to the next: build a fresh one per use.
 */
export const REFERENCE_TOKEN_SOURCE = `\\[\\[(${RECORD_REFERENCE_TYPES.join('|')}):(${UUID_SHAPE_PATTERN})\\]\\]`;

export interface RecordReferenceToken {
  type: RecordReferenceType;
  id: string;
}

export function formatRecordReferenceToken(type: RecordReferenceType, id: string): string {
  return `[[${type}:${id}]]`;
}

/** Every well-formed token in `text`, in first-appearance order, each target once. */
export function extractRecordReferenceTokens(text: string): RecordReferenceToken[] {
  const seen = new Set<string>();
  const tokens: RecordReferenceToken[] = [];
  for (const match of text.matchAll(new RegExp(REFERENCE_TOKEN_SOURCE, 'g'))) {
    const type = match[1] as RecordReferenceType;
    const id = (match[2] as string).toLowerCase();
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({ type, id });
  }
  return tokens;
}

/** A stretch of plain text, or one well-formed token, in the order they appear. */
export type RecordReferenceTextPart =
  | { kind: 'text'; text: string }
  | ({ kind: 'reference' } & RecordReferenceToken);

/**
 * `text` cut at its well-formed tokens, for a screen that shows each token as
 * a link: the parts, joined back, are the text. A malformed token, or one of a
 * type outside the seven, stays text.
 */
export function splitRecordReferenceText(text: string): RecordReferenceTextPart[] {
  const parts: RecordReferenceTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(new RegExp(REFERENCE_TOKEN_SOURCE, 'g'))) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ kind: 'text', text: text.slice(cursor, start) });
    parts.push({
      kind: 'reference',
      type: match[1] as RecordReferenceType,
      id: (match[2] as string).toLowerCase(),
    });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

/** The people a text mentions, each once, in first-appearance order. */
export function mentionedAdminUserIds(text: string | null | undefined): string[] {
  if (!text) return [];
  return extractRecordReferenceTokens(text)
    .filter((token) => token.type === 'admin_user')
    .map((token) => token.id);
}

/**
 * What an available Order reference says beyond its number
 * (`specs/158-crm-opportunity-inline-editing/`, FR-012): its status code — the
 * screen names it from `orders`' statuses — its total, when it was placed and
 * for whom (the billing company, else the billing recipient).
 */
export const RecordReferenceOrderSchema = z.object({
  status: z.string(),
  total: z.string(),
  currency: z.string(),
  placedAt: z.string(),
  customerName: z.string().nullable(),
});
export type RecordReferenceOrder = z.infer<typeof RecordReferenceOrderSchema>;

/**
 * A resolved reference, returned beside every free-text field. A target the
 * reader may not see, that is gone, or whose owning module is switched off is
 * `available: false` with no label. A person has a `label` — their name — and
 * never a `url`: the screen of an administrator is `admin_users`', behind a
 * permission of its own.
 */
export const RecordReferenceSchema = z.object({
  type: recordReferenceTypeSchema,
  id: z.string().uuid(),
  available: z.boolean(),
  label: z.string().nullable(),
  url: z.string().nullable(),
  /** Present on an available Order only. */
  order: RecordReferenceOrderSchema.optional(),
});
export type RecordReference = z.infer<typeof RecordReferenceSchema>;

// ---------------------------------------------------------------------------
// The `@@` document list (FR-044)
// ---------------------------------------------------------------------------

/**
 * The kinds the `@@` list groups, in the order it shows them. Opportunities and
 * Projects joined in `specs/165-task-management/` (R-5).
 */
export const RECORD_DOCUMENT_KINDS = ['order', 'quote_request', 'task', 'opportunity', 'project'] as const;
export const recordDocumentKindSchema = z.enum(RECORD_DOCUMENT_KINDS);
export type RecordDocumentKind = z.infer<typeof recordDocumentKindSchema>;

export const RecordDocumentLookupItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  sublabel: z.string().optional(),
});
export type RecordDocumentLookupItem = z.infer<typeof RecordDocumentLookupItemSchema>;

export const RecordDocumentLookupGroupSchema = z.object({
  kind: recordDocumentKindSchema,
  items: z.array(RecordDocumentLookupItemSchema),
});
export type RecordDocumentLookupGroup = z.infer<typeof RecordDocumentLookupGroupSchema>;

/**
 * The answer of `GET /projects/lookups/documents` and of
 * `GET /crm/lookups/documents` — one schema for both (FR-044). A group is
 * present only for a kind whose owning module is present and whose read
 * permission the caller holds (`orders:read`, `rfqs:handle`, `tasks:read`,
 * `crm:read`, `projects:read`).
 */
export const RecordDocumentLookupResponseSchema = z.object({
  groups: z.array(RecordDocumentLookupGroupSchema),
});
export type RecordDocumentLookupResponse = z.infer<typeof RecordDocumentLookupResponseSchema>;

// ---------------------------------------------------------------------------
// A record's history page — the audit trail of one record, read by its owner
// ---------------------------------------------------------------------------

export const RecordHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type RecordHistoryQuery = z.infer<typeof RecordHistoryQuerySchema>;

export const RecordHistoryEntrySchema = z.object({
  id: z.string(),
  actedAt: z.string(),
  action: z.string(),
  actor: z.object({
    kind: z.string(),
    id: z.string().nullable(),
    name: z.string().nullable(),
  }),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  /** What the tokens in this entry's texts name for this reader, so the history shows names. */
  references: z.array(RecordReferenceSchema),
});
export type RecordHistoryEntry = z.infer<typeof RecordHistoryEntrySchema>;

/**
 * `truncated` is beside `pagination` and not part of it: it is `true` on the
 * last page a history can serve when the record has earlier entries beyond the
 * cap it reaches back to (CRM's `OpportunityHistoryResponse`, the same shape).
 */
export const RecordHistoryPageSchema = collectionEnvelope(RecordHistoryEntrySchema).extend({
  truncated: z.boolean(),
});
export type RecordHistoryPage = z.infer<typeof RecordHistoryPageSchema>;
