import type { EntityManager } from '@mikro-orm/postgresql';
import { AUDIT_ERASED_MARKER, isUuidShape } from '@endora-commerce/contracts';
import type { AuditPort } from '../ports/audit.js';
import {
  AUDIT_REDACTED_ACTION,
  AUDIT_REDACTION_MAX_IDS_PER_TARGET,
  type AuditRedactionInput,
  type AuditRedactionPort,
  type AuditRedactionResult,
} from '../ports/audit-redaction.js';
import { redactAuditState } from './audit-redaction.js';

/**
 * The platform's implementation of {@link AuditRedactionPort} (issue #844) —
 * the one write on `audit_log_entries` that is not an append.
 *
 * **Like `AuditLogService`, the class is the host's, not the platform's
 * contract** (D-160.10): a module types on the port and reads the
 * `auditRedactionService` registration off its cradle.
 *
 * The algorithm, in the order it runs:
 *
 * 1. **Snapshot the work** — the ids of every row about the targets, the
 *    `audit.redacted` rows excepted, in id order. Ids only: a large history is
 *    a few megabytes of uuids, not of payloads.
 * 2. **Chunks of {@link AUDIT_REDACTION_CHUNK_SIZE}, one short transaction
 *    each** — load the chunk, compute the rule in TypeScript, drop every row
 *    the rule leaves as it is, and write the rest with **one** `update … from
 *    (values …)` statement. No lock is held across chunks.
 * 3. **The final transaction** — the ids again, less the ones already seen: a
 *    row written about a target while the run was under way is rewritten here,
 *    and the `audit.redacted` row is recorded in the same transaction, through
 *    the audit writer's `recordWithin`.
 *
 * A failure in any chunk rejects the call; the chunks before it stay written
 * and the next run skips them, because a row already erased is equal to its own
 * rewrite. The marker row is written when this run changed something, or when
 * the subject has none yet — so the first complete run writes exactly one, and
 * a re-run that finds nothing writes nothing.
 *
 * command-coverage-ignore: the customers retention sweep's system-initiated
 * erasure, with no admin request to route through `CommandBus.run`; it follows
 * the scrub owners' precedent of one co-transactional audit row (the marker),
 * and the rewritten rows are deliberately not re-audited one by one, which
 * would copy the values being erased into new rows (Principle XIII).
 *
 * **Tenancy.** `AuditLogEntry` is a global entity. The service opens no scope
 * of its own and runs inside its caller's (the sweep's system scope); it
 * selects nothing it was not named, by explicit `(objectType, objectId)` pairs.
 */

/** Rows per chunk — one `UPDATE` each. */
export const AUDIT_REDACTION_CHUNK_SIZE = 500;

/** Object ids per lookup of a target's rows — the call splits by it (issue #959). */
export const AUDIT_REDACTION_IDS_PER_LOOKUP = 1000;

const TABLE = '"audit_log_entries"';

interface StoredRow {
  id: string;
  state_before: Record<string, unknown> | null;
  state_after: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  actor_customer_account_id: string | null;
  object_type: string;
}

/** One row's rewritten columns, as {@link buildRedactionUpdate} writes them. */
export interface RedactedRow {
  id: string;
  stateBefore: Record<string, unknown> | null;
  stateAfter: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * The single statement one chunk is written with: the rewritten columns of
 * every row, joined by id. Refuses an empty chunk, which would be no statement.
 */
export function buildRedactionUpdate(rows: readonly RedactedRow[]): { sql: string; params: unknown[] } {
  if (rows.length === 0) throw new Error('buildRedactionUpdate: no rows to write.');
  const params: unknown[] = [];
  const tuples: string[] = [];
  for (const row of rows) {
    tuples.push('(?::uuid, ?::jsonb, ?::jsonb, ?::varchar, ?::varchar)');
    params.push(
      row.id,
      row.stateBefore === null ? null : JSON.stringify(row.stateBefore),
      row.stateAfter === null ? null : JSON.stringify(row.stateAfter),
      row.ipAddress,
      row.userAgent,
    );
  }
  const sql =
    `update ${TABLE} as a set "state_before" = v."sb", "state_after" = v."sa", ` +
    `"ip_address" = v."ip", "user_agent" = v."ua" ` +
    `from (values ${tuples.join(', ')}) as v("id", "sb", "sa", "ip", "ua") ` +
    `where a."id" = v."id"`;
  return { sql, params };
}

interface PreparedTarget {
  objectType: string;
  objectIds: string[];
  keepKeys: readonly string[];
}

interface RunTally {
  seen: Set<string>;
  changed: number;
  changedByType: Map<string, number>;
}

export class AuditRedactionService implements AuditRedactionPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditPort,
  ) {}

  async redact(input: AuditRedactionInput): Promise<AuditRedactionResult> {
    const targets = validate(input);
    const keepKeysByType = new Map(targets.map((t) => [t.objectType, t.keepKeys]));
    const subjectActor = input.subjectActorAccountId ?? null;
    const em = this.emFactory();
    const tally: RunTally = { seen: new Set(), changed: 0, changedByType: new Map() };

    // 1. The snapshot of the work.
    const snapshot = await this.listIds(em, targets);
    for (const id of snapshot) tally.seen.add(id);

    // 2. One transaction per chunk.
    for (let offset = 0; offset < snapshot.length; offset += AUDIT_REDACTION_CHUNK_SIZE) {
      const chunk = snapshot.slice(offset, offset + AUDIT_REDACTION_CHUNK_SIZE);
      await em.transactional((tx) => this.redactChunk(tx, chunk, keepKeysByType, subjectActor, tally));
    }

    // 3. The top-up pass and the marker, together.
    let markerWritten = false;
    await em.transactional(async (tx) => {
      const late = (await this.listIds(tx, targets)).filter((id) => !tally.seen.has(id));
      for (const id of late) tally.seen.add(id);
      for (let offset = 0; offset < late.length; offset += AUDIT_REDACTION_CHUNK_SIZE) {
        const chunk = late.slice(offset, offset + AUDIT_REDACTION_CHUNK_SIZE);
        await this.redactChunk(tx, chunk, keepKeysByType, subjectActor, tally);
      }
      if (tally.changed > 0 || !(await this.hasMarker(tx, input.subject.objectId))) {
        this.auditLog.recordWithin(tx, {
          actorAdminUserId: null,
          action: AUDIT_REDACTED_ACTION,
          objectType: input.subject.objectType,
          objectId: input.subject.objectId,
          stateBefore: null,
          // Counts and ids only: the marker must not copy what it erased.
          stateAfter: {
            reason: input.reason,
            rowsInScope: tally.seen.size,
            rowsChanged: tally.changed,
            byObjectType: Object.fromEntries(
              targets.map((t) => [t.objectType, tally.changedByType.get(t.objectType) ?? 0]),
            ),
            objectIds: Object.fromEntries(targets.map((t) => [t.objectType, t.objectIds])),
          },
        });
        markerWritten = true;
      }
    });

    return { rowsInScope: tally.seen.size, rowsChanged: tally.changed, markerWritten };
  }

  /**
   * The ids of every in-scope row, the markers excepted, in id order within
   * each lookup. A target's object ids are looked up
   * {@link AUDIT_REDACTION_IDS_PER_LOOKUP} at a time (issue #959).
   */
  private async listIds(em: EntityManager, targets: readonly PreparedTarget[]): Promise<string[]> {
    const ids: string[] = [];
    for (const target of targets) {
      for (let offset = 0; offset < target.objectIds.length; offset += AUDIT_REDACTION_IDS_PER_LOOKUP) {
        const objectIds = target.objectIds.slice(offset, offset + AUDIT_REDACTION_IDS_PER_LOOKUP);
        const rows = await em.execute<Array<{ id: string }>>(
          `select "id" from ${TABLE} where "object_type" = ? ` +
            `and "object_id" in (${objectIds.map(() => '?').join(', ')}) ` +
            `and "action" <> '${AUDIT_REDACTED_ACTION}' order by "id"`,
          [target.objectType, ...objectIds],
        );
        for (const row of rows) ids.push(row.id);
      }
    }
    return [...new Set(ids)];
  }

  private async redactChunk(
    tx: EntityManager,
    ids: readonly string[],
    keepKeysByType: ReadonlyMap<string, readonly string[]>,
    subjectActor: string | null,
    tally: RunTally,
  ): Promise<void> {
    if (ids.length === 0) return;
    const stored = await tx.execute<StoredRow[]>(
      `select "id", "state_before", "state_after", "ip_address", "user_agent", ` +
        `"actor_customer_account_id", "object_type" from ${TABLE} ` +
        `where "id" in (${ids.map(() => '?').join(', ')}) and "action" <> '${AUDIT_REDACTED_ACTION}'`,
      [...ids],
    );
    const changed: RedactedRow[] = [];
    for (const row of stored) {
      const policy = { keepKeys: keepKeysByType.get(row.object_type) ?? [] };
      const own = subjectActor !== null && row.actor_customer_account_id === subjectActor;
      const next: RedactedRow = {
        id: row.id,
        stateBefore: redactAuditState(row.state_before, policy),
        stateAfter: redactAuditState(row.state_after, policy),
        ipAddress: own && row.ip_address !== null ? AUDIT_ERASED_MARKER : row.ip_address,
        userAgent: own && row.user_agent !== null ? AUDIT_ERASED_MARKER : row.user_agent,
      };
      if (sameRow(row, next)) continue;
      changed.push(next);
      tally.changedByType.set(row.object_type, (tally.changedByType.get(row.object_type) ?? 0) + 1);
    }
    if (changed.length === 0) return;
    await this.writeChunk(tx, changed);
    tally.changed += changed.length;
  }

  /** One statement for the whole chunk. A method of its own so a test can fail it. */
  private async writeChunk(tx: EntityManager, rows: readonly RedactedRow[]): Promise<void> {
    const { sql, params } = buildRedactionUpdate(rows);
    await tx.execute(sql, params);
  }

  private async hasMarker(tx: EntityManager, subjectId: string): Promise<boolean> {
    const rows = await tx.execute<unknown[]>(
      `select 1 from ${TABLE} where "object_type" = ? and "object_id" = ? ` +
        `and "action" = '${AUDIT_REDACTED_ACTION}' limit 1`,
      ['customer_account', subjectId],
    );
    return rows.length > 0;
  }
}

function validate(input: AuditRedactionInput): PreparedTarget[] {
  const refuse = (why: string): never => {
    throw new Error(`AuditRedactionService.redact refused: ${why}.`);
  };
  if (input.reason !== 'anonymization') refuse(`unknown reason '${String(input.reason)}'`);
  if (input.subject?.objectType !== 'customer_account') refuse('the subject must be a customer_account');
  if (typeof input.subject.objectId !== 'string' || !isUuidShape(input.subject.objectId)) {
    refuse('the subject id is not UUID-shaped');
  }
  const actor = input.subjectActorAccountId;
  if (actor !== undefined && actor !== null && !isUuidShape(actor)) {
    refuse('the subject actor id is not UUID-shaped');
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) refuse('no target');
  const seenTypes = new Set<string>();
  return input.targets.map((target) => {
    if (typeof target.objectType !== 'string' || target.objectType.length === 0) refuse('a target has no object type');
    if (seenTypes.has(target.objectType)) refuse(`object type '${target.objectType}' is named twice`);
    seenTypes.add(target.objectType);
    const ids = [...new Set(target.objectIds)];
    if (ids.length === 0) refuse(`target '${target.objectType}' names no id`);
    if (ids.length > AUDIT_REDACTION_MAX_IDS_PER_TARGET) {
      refuse(`target '${target.objectType}' names more than ${AUDIT_REDACTION_MAX_IDS_PER_TARGET} ids`);
    }
    for (const id of ids) {
      if (typeof id !== 'string' || !isUuidShape(id)) refuse(`target '${target.objectType}' names an id that is not UUID-shaped`);
    }
    return { objectType: target.objectType, objectIds: ids, keepKeys: target.keepKeys ?? [] };
  });
}

/** Whether the rewrite equals what the row holds — then it is not written. */
function sameRow(stored: StoredRow, next: RedactedRow): boolean {
  return (
    stored.ip_address === next.ipAddress &&
    stored.user_agent === next.userAgent &&
    canonical(stored.state_before) === canonical(next.stateBefore) &&
    canonical(stored.state_after) === canonical(next.stateAfter)
  );
}

/** JSON with sorted keys: `jsonb` does not keep the order a writer used. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
