import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import {
  ERROR_CODES,
  type CommandOutboxListItem,
  type CommandOutboxListQuery,
  type CommandOutboxListResponse,
} from '@endora-commerce/contracts';
import type { Command } from '../command.js';
import { HttpError } from '../../http/error-envelope.js';
import { CommandOutboxEntry } from './command-outbox-entry.entity.js';

/**
 * The operator's half of the command outbox (`specs/176-command-hooks-outbox/`
 * P4, FR-040, `contracts/outbox-and-admin-api.md` § Admin API): a list of rows
 * by status, and the audited retry of a dead one.
 *
 * **Nothing here reads `data`.** The list selects the operator fields by name
 * and the retry's result is built from the same projection, so a row's
 * `outboxData` never leaves the table through this surface — an operator reads
 * nothing here the audit log would not show. A failure was stored as a code
 * and a class only, so there is no message to leak either.
 */

interface ListRow {
  id: string;
  sequence: string | number;
  action: string;
  object_type: string;
  object_id: string;
  organization_id: string | null;
  hook_module: string;
  hook_id: string;
  status: CommandOutboxListItem['status'];
  attempts: number;
  last_error_code: string | null;
  last_error_class: string | null;
  created_at: Date | string;
  available_at: Date | string;
  dead_at: Date | string | null;
}

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

function toItem(row: ListRow): CommandOutboxListItem {
  return {
    id: row.id,
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    organizationId: row.organization_id,
    hookModule: row.hook_module,
    hookId: row.hook_id,
    status: row.status,
    attempts: Number(row.attempts),
    lastErrorCode: row.last_error_code,
    lastErrorClass: row.last_error_class,
    createdAt: iso(row.created_at),
    availableAt: iso(row.available_at),
    deadAt: row.dead_at === null ? null : iso(row.dead_at),
  };
}

const LIST_COLUMNS = `"id", "sequence", "action", "object_type", "object_id", "organization_id", "hook_module",
  "hook_id", "status", "attempts", "last_error_code", "last_error_class", "created_at", "available_at", "dead_at"`;

/**
 * One page of rows in `query.status`, newest first, keyset-paginated on
 * `sequence` (served by `command_outbox_status_seq_idx`). Raw SQL because
 * `sequence` is deliberately not mapped on the entity: the database assigns it.
 * One row past the page is read to decide whether there is a next one.
 */
export async function listCommandOutbox(em: EntityManager, query: CommandOutboxListQuery): Promise<CommandOutboxListResponse> {
  const params: unknown[] = [query.status];
  let keyset = '';
  if (query.cursor !== undefined) {
    keyset = ' and "sequence" < ?';
    params.push(query.cursor);
  }
  params.push(query.limit + 1);
  const rows = await em.execute<ListRow[]>(
    `select ${LIST_COLUMNS} from "command_outbox"
      where "status" = ?${keyset}
      order by "sequence" desc
      limit ?`,
    params,
  );
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    nextCursor: rows.length > query.limit && last !== undefined ? String(last.sequence) : null,
  };
}

/** The retried row's state, before and after: the status and nothing else (contract § Admin API). */
type RetryAuditState = { status: CommandOutboxEntry['status'] };

/**
 * `command_outbox.retry` — move a dead row back to `pending`, due now, with
 * its attempts reset, so the next drain tick delivers it (FR-040).
 *
 * The row is read under `for update` on the Command's transaction, so two
 * operators retrying the same row serialise and the second is answered `409`.
 * `deadAt` is cleared because the row is no longer dead; the last failure's
 * code and class stay until the next attempt overwrites them, so the list
 * still says why the row had died.
 *
 * Audit state is names-only and closed: `{ status: 'dead' } → { status:
 * 'pending' }` (`specs/conventions/audit-state.md` list 1). The row is
 * platform-global and holds only list-1 data, but nothing of it is copied into
 * the entry beyond the status the Command changed.
 *
 * Not reversible: undoing a retry would mean dead-lettering a row the drain
 * may already have delivered.
 */
export function makeRetryCommandOutboxCommand(id: string): Command<CommandOutboxListItem> {
  return {
    action: 'command_outbox.retry',
    objectType: 'command_outbox',
    objectId: id,
    run: async ({ em }) => {
      const entry = await em.findOne(CommandOutboxEntry, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!entry) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `No command outbox row "${id}".`);
      }
      if (entry.status !== 'dead') {
        throw new HttpError(
          409,
          ERROR_CODES.COMMAND_OUTBOX_NOT_DEAD,
          `Command outbox row "${id}" is ${entry.status}, not dead: only a failed delivery can be retried.`,
          { status: entry.status },
        );
      }
      const before: RetryAuditState = { status: entry.status };
      entry.status = 'pending';
      entry.attempts = 0;
      entry.availableAt = new Date();
      entry.lockedUntil = null;
      entry.deadAt = null;
      await em.flush();

      const [row] = await em.execute<ListRow[]>(`select ${LIST_COLUMNS} from "command_outbox" where "id" = ?`, [id]);
      if (!row) {
        throw new HttpError(500, ERROR_CODES.INTERNAL, `Command outbox row "${id}" vanished inside its own retry.`);
      }
      const after: RetryAuditState = { status: 'pending' };
      return { result: toItem(row), before, after };
    },
  };
}
