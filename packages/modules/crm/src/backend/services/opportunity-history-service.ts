import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type OpportunityHistoryQuery,
  type OpportunityHistoryResponse,
  type OpportunityReference,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { CrmOpportunityValueChange } from '../entities/crm-opportunity-value-change.entity.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';
import type { ReferenceService } from './reference-service.js';

export interface OpportunityHistoryServiceDeps {
  emFactory: () => EntityManager;
  /** The kernel's audit port — a platform service, read like `audit_logs`' own route reads it. */
  auditLog: Pick<AuditPort, 'query'>;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  /** What the tokens of an audited text name, for the reader. */
  references: Pick<ReferenceService, 'resolveMany'>;
  /**
   * Feature 162 (owner ruling P2 = a) — whether the caller may read custom
   * fields (`custom_fields:read`). Without it, no entry serves the
   * Opportunity's custom-field values.
   */
  mayReadCustomFields: () => Promise<boolean>;
}

/** The audited keys that hold a text which may carry reference tokens. */
const TEXT_FIELDS = ['description'] as const;

/** The texts of one audited state — as it was, or as it is. */
function textsOf(state: unknown): string[] {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return [];
  return TEXT_FIELDS.map((field) => (state as Record<string, unknown>)[field]).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
}

/** The keys of a state that belong to `custom_fields`: the values, and the names of the changed ones. */
const CUSTOM_FIELD_KEYS = ['customFieldValues', 'changedCustomFields'] as const;

/**
 * An audited state as the reader may see it: without `customFieldValues` and
 * `changedCustomFields` for a caller who may not read custom fields.
 * `customFieldCarry` names keys and reasons, never a value, and stays. The
 * audit entry itself is never rewritten.
 */
function visibleState(state: unknown, mayReadCustomFields: boolean): unknown {
  if (mayReadCustomFields || state === null || typeof state !== 'object' || Array.isArray(state)) return state;
  if (!CUSTOM_FIELD_KEYS.some((key) => Object.hasOwn(state, key))) return state;
  const rest = { ...(state as Record<string, unknown>) };
  for (const key of CUSTOM_FIELD_KEYS) delete rest[key];
  return rest;
}

/** The audit keys that stand in for the values the Opportunity's own store keeps (#470). */
const VALUE_POINTER = 'valueChangeId';
const VALUE_NAMES = ['changedFields', 'changedCustomFields'] as const;

function asRecord(state: unknown): Record<string, unknown> | null {
  return state === null || typeof state !== 'object' || Array.isArray(state) ? null : (state as Record<string, unknown>);
}

/** The `crm_opportunity_value_changes` row an entry points at — on the side that has one — or `null`. */
export function valueChangeIdOf(entry: { before: unknown; after: unknown }): string | null {
  for (const state of [entry.after, entry.before]) {
    const id = asRecord(state)?.[VALUE_POINTER];
    if (typeof id === 'string' && isUuid(id)) return id;
  }
  return null;
}

/** One row of the value store: the changed values of one write, either side. */
export interface StoredValueChange {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * An entry with the values the Opportunity's store kept for it (#470): the
 * audit entry names what changed and points at the row by `valueChangeId`;
 * the history serves the values in place of the names, in the shape entries
 * written before #470 carried them, so the tab reads both alike. Without a
 * row the names stay and only the pointer goes.
 */
export function withStoredValues(
  entry: { before: unknown; after: unknown },
  change: StoredValueChange | null,
): { before: unknown; after: unknown } {
  const strip = (state: unknown): unknown => {
    const record = asRecord(state);
    if (!record || !(VALUE_POINTER in record || (change && VALUE_NAMES.some((key) => key in record)))) return state;
    const out = { ...record };
    delete out[VALUE_POINTER];
    if (change) for (const key of VALUE_NAMES) delete out[key];
    return out;
  };
  const merge = (state: unknown, values: Record<string, unknown> | null): unknown => {
    const stripped = strip(state);
    if (!values) return stripped;
    return { ...(asRecord(stripped) ?? {}), ...values };
  };
  return { before: merge(entry.before, change?.before ?? null), after: merge(entry.after, change?.after ?? null) };
}

/** The object type every Command about an Opportunity, or anything hanging on it, is recorded under. */
export const OPPORTUNITY_AUDIT_OBJECT_TYPE = 'crm_opportunity';

/** The most the audit port answers in one read (`AuditPort.query`), whatever is asked. */
const AUDIT_QUERY_CAP = 500;

/**
 * How far back a history reaches. The audit port answers the newest entries of
 * an object, capped, and takes no offset, so the pages are cut from one capped
 * read — and the history serves **one entry fewer than the cap**: a read that
 * comes back full then proves there is an earlier entry, and the last page
 * says so (`truncated`) instead of ending as if it were the whole of it.
 */
export const HISTORY_REACH = AUDIT_QUERY_CAP - 1;

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
  } catch {
    // Falls through to the refusal below: a cursor is opaque, and one this
    // service did not issue is a malformed request rather than "page one".
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this history issued.');
}

/**
 * The change history of an Opportunity
 * (`specs/143-crm-sales-opportunities/research.md` R-16).
 *
 * **The audit log is the history.** Every write about an Opportunity is a
 * Command recorded against `crm_opportunity` and the Opportunity's id, in the
 * transaction of the write, so this cannot disagree with the data — and it is
 * the whole of it: an edit, a status change (with what caused it, and the
 * Order when an Order did), a link, an assignment, a tag change, a note, a
 * message, an attachment.
 *
 * **Tenant scope comes from the parent.** An audit entry is not any
 * Organization's row, so nothing filters a read of one. The Opportunity is
 * loaded through the scoped EntityManager first — absent or out of scope is the
 * same 404 — and only then are the entries of *that id* read.
 *
 * Served to `crm:read`, not `audit_log:read`: a Sales Rep reads what happened
 * to their Opportunity without being given the platform's whole audit log.
 *
 * **The values come from the Opportunity's own store** (issue #470, D-288).
 * Since #470 an entry names what a write changed (`changedFields`,
 * `changedCustomFields`) and points at a `crm_opportunity_value_changes` row
 * by `valueChangeId`; the row is read by this Opportunity's id, after the
 * Opportunity was loaded through the scoped EntityManager, and its values are
 * served in place of the names. Entries written before #470 still carry their
 * values in the audit row and are served as they are: nothing rewrites them.
 *
 * **A text is returned as it was audited, tokens and all**, with what its
 * tokens name beside it — resolved now, for this reader, under the rule every
 * other text of the module is read by (User Story 18; research N-M6). The
 * audit entry itself is never rewritten.
 *
 * **A history that is cut says that it is.** Past `HISTORY_REACH` entries there
 * is no next page; the last page then carries `truncated: true`. `hasMore`
 * keeps its one meaning — a next page exists and `cursor` asks for it.
 *
 * **Custom-field values need `custom_fields:read`** (feature 162, owner ruling
 * P2 = a). `crm:read`'s `requires` is advisory, so a reader may hold it alone;
 * for that reader every entry's `before` and `after` are served without
 * `customFieldValues`, decided here, server-side, once per page.
 *
 * The `action` of an entry is the Command's (`crm.opportunity.transition`); the
 * Admin UI labels it with `auditLog.<action>` from this module's bundle.
 */
export class OpportunityHistoryService {
  constructor(private readonly deps: OpportunityHistoryServiceDeps) {}

  async list(
    opportunityId: string,
    query: OpportunityHistoryQuery,
  ): Promise<OpportunityHistoryResponse> {
    const offset = decodeCursor(query.cursor);
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, opportunityId);

    // Newest first, from the port. One row more than the page tells whether
    // there is another page; nothing is asked beyond the port's own cap.
    const wanted = Math.min(offset + query.limit + 1, AUDIT_QUERY_CAP);
    const read = await this.deps.auditLog.query({
      objectType: OPPORTUNITY_AUDIT_OBJECT_TYPE,
      objectId: opportunity.id,
      limit: wanted,
    });
    const entries = read.slice(0, HISTORY_REACH);
    const page = entries.slice(offset, offset + query.limit);
    const hasMore = entries.length > offset + query.limit;
    // The row past the reach is never served; that it exists is what is said.
    const truncated = !hasMore && read.length > HISTORY_REACH;

    const actorIds = [...new Set(page.map((entry) => entry.actorAdminUserId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length > 0 ? await this.deps.adminUsers.findByIds(actorIds) : [];
    const actorNames = new Map(
      actors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );

    // The values the audit entries name, from the Opportunity's own store —
    // by this Opportunity's id, so a pointer to another one's row reads nothing.
    const pointers = page
      .map((entry) => valueChangeIdOf({ before: entry.stateBefore ?? null, after: entry.stateAfter ?? null }))
      .filter((id): id is string => id !== null);
    const stored =
      pointers.length > 0
        ? await em.find(CrmOpportunityValueChange, { opportunityId: opportunity.id, id: { $in: pointers } })
        : [];
    const changes = new Map<string, StoredValueChange>(
      stored.map((row) => [row.id, { before: row.before ?? null, after: row.after ?? null }]),
    );
    const states = page.map((entry) => {
      const raw = { before: entry.stateBefore ?? null, after: entry.stateAfter ?? null };
      const pointer = valueChangeIdOf(raw);
      return withStoredValues(raw, pointer === null ? null : (changes.get(pointer) ?? null));
    });

    // One resolution for the whole page, as a page of comments has.
    const texts = states.map((state) => [...textsOf(state.before), ...textsOf(state.after)]);
    const resolved = await this.deps.references.resolveMany(texts.map((list) => list.join('\n')));
    const referencesOf = (index: number): OpportunityReference[] => resolved[index] ?? [];
    const mayReadCustomFields = page.length > 0 ? await this.deps.mayReadCustomFields() : true;

    return {
      data: page.map((entry, index) => {
        const actorId = entry.actorAdminUserId ?? null;
        return {
          id: entry.id,
          actedAt: entry.actedAt.toISOString(),
          action: entry.action,
          // No administrator behind an entry means the system wrote it: a
          // subscriber following an Order, or an automatic creation.
          actor:
            actorId === null
              ? { kind: 'system', id: null, name: null }
              : { kind: 'admin', id: actorId, name: actorNames.get(actorId) ?? null },
          before: visibleState(states[index]?.before ?? null, mayReadCustomFields),
          after: visibleState(states[index]?.after ?? null, mayReadCustomFields),
          references: referencesOf(index),
        };
      }),
      pagination: {
        cursor: hasMore ? encodeCursor(offset + query.limit) : null,
        hasMore,
        limit: query.limit,
      },
      truncated,
    };
  }
}
