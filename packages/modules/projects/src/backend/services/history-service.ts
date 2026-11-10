import {
  ERROR_CODES,
  type AdminUserReadPort,
  type RecordHistoryPage,
  type RecordHistoryQuery,
  type RecordReference,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { reaches, type OrgReach } from '../domain/visibility-rule.js';
import { ambientReach, isUuid, uuidArray, type ProjectAccess } from './project-access.js';
import type { ProjectReferenceService } from './reference-service.js';

/** The object type every Command about a Project, or anything hanging on it, is recorded under. */
export const PROJECT_AUDIT_OBJECT_TYPE = 'project';

/** The most the audit port answers in one read (`AuditPort.query`), whatever is asked. */
const AUDIT_QUERY_CAP = 500;

/**
 * How far back a history reaches: one entry fewer than the cap, so a read that
 * comes back full proves an earlier entry exists and the last page says so
 * (`truncated`) — CRM's `opportunity-history-service.ts`, the model.
 */
export const PROJECT_HISTORY_REACH = AUDIT_QUERY_CAP - 1;

/** The audited keys that hold a text which may carry reference tokens. */
const TEXT_FIELDS = ['description'] as const;

/** The texts of one audited state. */
export function auditedTexts(state: unknown): string[] {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return [];
  return TEXT_FIELDS.map((field) => (state as Record<string, unknown>)[field]).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
}

/** The audited keys that belong to `custom_fields`: the values of old entries, the changed keys of new ones. */
const CUSTOM_FIELD_KEYS = ['customFieldValues', 'changedCustomFields'] as const;

/**
 * An audited state as the reader may see it: without the custom fields —
 * `customFieldValues` (entries written before T144 F4) and `changedCustomFields`
 * — for a reader who may not read custom fields (`custom_fields:read`, User
 * Story 9). The audit entry itself is never rewritten.
 */
export function visibleAuditState(state: unknown, mayReadCustomFields: boolean): unknown {
  if (mayReadCustomFields || state === null || typeof state !== 'object' || Array.isArray(state)) return state;
  if (!CUSTOM_FIELD_KEYS.some((key) => Object.hasOwn(state, key))) return state;
  const rest = { ...(state as Record<string, unknown>) };
  for (const key of CUSTOM_FIELD_KEYS) delete rest[key];
  return rest;
}

/**
 * An audited state without any Organization out of the reader's reach (T144
 * F4). A Project the reader sees today has every Organization in their reach,
 * but its history remembers the ones it had: `organizationIds` keeps those in
 * reach, an `organizationId` out of reach is blanked — and with it the
 * `recordId` of a link that named it, which is that Organization's record.
 */
export function withinReach(state: unknown, reach: OrgReach): unknown {
  if (reach.all || state === null || typeof state !== 'object' || Array.isArray(state)) return state;
  const record = state as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };
  if (Array.isArray(record.organizationIds)) {
    out.organizationIds = record.organizationIds.filter(
      (id) => typeof id === 'string' && reaches(reach, id),
    );
  }
  if (typeof record.organizationId === 'string' && !reaches(reach, record.organizationId)) {
    out.organizationId = null;
    if (Object.hasOwn(record, 'recordId')) out.recordId = null;
  }
  return out;
}

/** The audit keys that stand in for values the Project's own store keeps (T144 F4, T145). */
const VALUE_POINTER = 'valueChangeId';
const VALUE_NAMES = ['changedFields', 'changedCustomFields'] as const;

/** One row of `project_value_changes`: the changed values of one write, either side. */
export interface StoredValueChange {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

/** The `project_value_changes` row an audited state points at, or `null`. */
export function valueChangeIdOf(state: unknown): string | null {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return null;
  const id = (state as Record<string, unknown>)[VALUE_POINTER];
  return typeof id === 'string' && isUuid(id) ? id : null;
}

function asRecord(state: unknown): Record<string, unknown> | null {
  return state === null || typeof state !== 'object' || Array.isArray(state) ? null : (state as Record<string, unknown>);
}

/**
 * An entry with the values the Project's store kept for it (T145, issue #470):
 * the audit trail names the changed fields (`changedFields`,
 * `changedCustomFields`) and points at the store by `valueChangeId`; the
 * history serves the values in their place — `valueAmount` / `valueCurrency`
 * and `customFieldValues` of the changed keys, before and after, as entries
 * written before T144 F4 carried them. A create has no state before, so its
 * values join the state after only. Without a stored row the names stay and
 * only the pointer goes.
 */
export function withValueChange(
  entry: { before: unknown; after: unknown },
  change: StoredValueChange | null,
): { before: unknown; after: unknown } {
  const strip = (state: unknown, replaced: boolean): unknown => {
    const record = asRecord(state);
    if (!record || !(VALUE_POINTER in record || (replaced && VALUE_NAMES.some((key) => key in record)))) return state;
    const out = { ...record };
    delete out[VALUE_POINTER];
    if (replaced) for (const key of VALUE_NAMES) delete out[key];
    return out;
  };
  if (!change) return { before: strip(entry.before, false), after: strip(entry.after, false) };
  const merge = (state: unknown, values: Record<string, unknown> | null): unknown => {
    const stripped = strip(state, true);
    if (!values) return stripped;
    return { ...(asRecord(stripped) ?? {}), ...values };
  };
  return {
    before: entry.before === null && change.before === null ? null : merge(entry.before, change.before),
    after: merge(entry.after, change.after),
  };
}

export function encodeHistoryCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function decodeHistoryCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
  } catch {
    // Falls through: a cursor this service did not issue is a malformed request.
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this history issued.');
}

export interface ProjectHistoryServiceDeps {
  emFactory: () => EntityManager;
  access: Pick<ProjectAccess, 'loadVisible'>;
  /** The kernel's audit port — a platform service. */
  auditLog: Pick<AuditPort, 'query'>;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  references: Pick<ProjectReferenceService, 'resolveMany'>;
  /** Whether the reader holds `custom_fields:read`. */
  mayReadCustomFields: () => Promise<boolean>;
}

/**
 * `GET /projects/:id/history` (FR-028; `contracts/admin-api.md` §2.4) — **the
 * audit log is the history**: every write about a Project is a Command recorded
 * against `project` and its id, in the transaction of the write.
 *
 * The Project is loaded through `ProjectAccess` first — invisible, out of reach
 * and missing are the same 404 — and only then are the entries of that id read.
 * Served to `projects:read`, not `audit_log:read`. Newest first, cursor-paged,
 * reaching back {@link PROJECT_HISTORY_REACH} entries; the last page says when
 * it was cut. What the tokens of an audited text name is resolved for the
 * reader (no Project Command audits a text today — notes and messages are
 * recorded by length — so this is the standard, ready). The audit log names
 * the value and the custom fields a write changed, never their values (T144
 * F4); the values are the Project's own store's, read by this Project's id and
 * served in place of the names (T145, issue #470). Custom fields — their
 * values or their names — are served only to a reader holding
 * `custom_fields:read`, and no Organization out of the reader's reach is served
 * at all (T144 F4).
 */
export class ProjectHistoryService {
  constructor(private readonly deps: ProjectHistoryServiceDeps) {}

  async list(projectId: string, query: RecordHistoryQuery): Promise<RecordHistoryPage> {
    const offset = decodeHistoryCursor(query.cursor);
    const project = await this.deps.access.loadVisible(projectId);

    const read = await this.deps.auditLog.query({
      objectType: PROJECT_AUDIT_OBJECT_TYPE,
      objectId: project.id,
      limit: Math.min(offset + query.limit + 1, AUDIT_QUERY_CAP),
    });
    const entries = read.slice(0, PROJECT_HISTORY_REACH);
    const page = entries.slice(offset, offset + query.limit);
    const hasMore = entries.length > offset + query.limit;
    const truncated = !hasMore && read.length > PROJECT_HISTORY_REACH;

    const actorIds = [
      ...new Set(page.map((entry) => entry.actorAdminUserId).filter((id): id is string => Boolean(id))),
    ];
    const actors = actorIds.length > 0 ? await this.deps.adminUsers.findByIds(actorIds) : [];
    const names = new Map(
      actors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );

    const texts = page.map((entry) =>
      [...auditedTexts(entry.stateBefore), ...auditedTexts(entry.stateAfter)].join('\n'),
    );
    const resolved = await this.deps.references.resolveMany(texts);
    const referencesOf = (index: number): RecordReference[] => resolved[index] ?? [];
    const mayReadCustomFields = page.length > 0 ? await this.deps.mayReadCustomFields() : true;
    const reach = await ambientReach();
    const served = (state: unknown): unknown => withinReach(visibleAuditState(state ?? null, mayReadCustomFields), reach);
    const changes = await this.#valueChanges(
      project.id,
      page.map((entry) => valueChangeIdOf(entry.stateAfter)).filter((id): id is string => id !== null),
    );

    return {
      data: page.map((entry, index) => {
        const actorId = entry.actorAdminUserId ?? null;
        const changeId = valueChangeIdOf(entry.stateAfter);
        const { before, after } = withValueChange(
          { before: entry.stateBefore ?? null, after: entry.stateAfter ?? null },
          changeId === null ? null : (changes.get(changeId) ?? null),
        );
        return {
          id: entry.id,
          actedAt: entry.actedAt.toISOString(),
          action: entry.action,
          actor:
            actorId === null
              ? { kind: 'system', id: null, name: null }
              : { kind: 'admin', id: actorId, name: names.get(actorId) ?? null },
          before: served(before),
          after: served(after),
          references: referencesOf(index),
        };
      }),
      pagination: {
        cursor: hasMore ? encodeHistoryCursor(offset + query.limit) : null,
        hasMore,
        limit: query.limit,
      },
      truncated,
    };
  }

  /**
   * The stored values of the page's entries, by row id — keyed by the Project
   * `loadVisible` handed out, so a pointer to another Project's row reads nothing.
   */
  async #valueChanges(projectId: string, ids: readonly string[]): Promise<Map<string, StoredValueChange>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.deps.emFactory().execute(
      `select v."id", v."before", v."after" from "project_value_changes" v
        where v."project_id" = ? and v."id" = any(?::uuid[])`,
      [projectId, uuidArray(ids)],
    )) as Array<{ id: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>;
    return new Map(rows.map((row) => [row.id, { before: row.before, after: row.after }]));
  }
}
