import { randomUUID } from 'node:crypto';
import type { MergeParticipant } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { AuditSentinel, AuditStateCarrier } from '@endora-commerce/test-kit/audit';
import { expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { TEST_ADMIN_ID } from './test-actors.js';
import { mergeSql } from './organization-merge-conformance.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * `specs/192-organization-merge/` US6 (T084, T085) — one participant of a
 * **Project** merge, as the composition registered it, held to
 * `expectMergeParticipant` over a real database
 * (`contracts/merge-participant.md` §3). The Project-host twin of
 * `organization-merge-conformance.ts`, with the same seams:
 *
 *  - **scope** — every call runs under the merge's system scope;
 *  - **events** — the composition's bus is counted around the step;
 *  - **audit** — the step's entries are read back from `audit_log_entries`
 *    (action, `object_type = 'project'` and the survivor) after every call;
 *  - **failure** — a row trigger on the table the batch consumes, narrowed to
 *    the loser's rows, raises while armed, so a batch must roll back whole.
 */

/** A live Project in its one Stage, written straight to its tables. */
export async function mergeProject(h: BackendServerHandle, title = 'Merge participant'): Promise<string> {
  const id = randomUUID();
  const stageId = randomUUID();
  await h
    .em()
    .fork()
    .transactional(async (em) => {
      await em.execute(
        `insert into "projects" ("id","number","title","visibility","created_by_admin_user_id") values (?, ?, ?, 'everyone', ?)`,
        [id, `PRJ-M${id.slice(0, 8)}`, title, TEST_ADMIN_ID],
      );
      await em.execute(
        `insert into "project_stages" ("id","project_id","name","color","position") values (?, ?, 'Design', '#3b82f6', 1)`,
        [stageId, id],
      );
      await em.execute(`update "projects" set "current_stage_id" = ? where "id" = ?`, [stageId, id]);
    });
  return id;
}

/** The participant a module registered for the Project host under `key`. */
export function composedProjectParticipant(h: BackendServerHandle, moduleId: string, key: string): MergeParticipant<'project'> {
  const found = h.recordMergeRuntime.registry
    .participantsOf('project')
    .find((entry) => entry.moduleId === moduleId && entry.key === key);
  if (!found) throw new Error(`no composed Project merge participant ${moduleId}/${key}`);
  return found.participant as MergeParticipant<'project'>;
}

export interface ComposedProjectParticipantCase {
  readonly moduleId: string;
  readonly key: string;
  /** The module's batch Command action, whose audit entries are read back. */
  readonly action: string;
  readonly seed: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<void>;
  readonly snapshot: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<unknown>;
  /** The table the batch consumes the loser's state in, the statement kind, and the `OLD` row condition naming the loser. */
  readonly failOn: { readonly table: string; readonly on: 'UPDATE' | 'DELETE'; readonly when: (loserId: string) => string };
  readonly batchSize?: number;
  readonly sentinels?: readonly AuditSentinel[];
}

export async function expectComposedProjectParticipant(
  h: BackendServerHandle,
  c: ComposedProjectParticipantCase,
): Promise<{ readonly survivorId: string; readonly loserId: string; readonly mergeId: string; readonly moved: number; readonly batches: number }> {
  const real = composedProjectParticipant(h, c.moduleId, c.key);
  const survivorId = await mergeProject(h, 'Survivor');
  const loserId = await mergeProject(h, 'Loser');
  const mergeId = randomUUID();

  let audit: AuditStateCarrier[] = [];
  const refreshAudit = async (): Promise<void> => {
    audit = (
      await mergeSql<Array<{ action: string; state_before: unknown; state_after: unknown }>>(
        h,
        `select "action", "state_before", "state_after" from "audit_log_entries"
          where "action" = ? and "object_type" = 'project' and "object_id" = ? order by "acted_at", "id"`,
        [c.action, survivorId],
      )
    ).map((row) => ({
      action: row.action,
      stateBefore: (row.state_before ?? null) as AuditStateCarrier['stateBefore'],
      stateAfter: (row.state_after ?? null) as AuditStateCarrier['stateAfter'],
    }));
  };
  let pending: Promise<unknown> = Promise.resolve();
  const settled = async (): Promise<void> => {
    await pending;
  };
  const participant: MergeParticipant<'project'> = {
    host: real.host,
    preview: async (input) => {
      await settled();
      return real.preview(input);
    },
    applyBatch: async (input) => {
      await settled();
      try {
        return await real.applyBatch(input);
      } finally {
        await refreshAudit();
      }
    },
  };

  let emitted = 0;
  const bus = h.eventBus as unknown as { emit: (...args: unknown[]) => unknown };
  const emit = bus.emit;
  bus.emit = (...args: unknown[]) => {
    emitted += 1;
    return emit.apply(h.eventBus, args);
  };

  const trigger = `merge_project_participant_fail_${c.failOn.table}`.slice(0, 60);
  await mergeSql(
    h,
    `create or replace function "merge_participant_injected_failure"() returns trigger language plpgsql as $$
       begin raise exception 'injected merge participant failure'; end $$`,
  );
  try {
    const result = await expectMergeParticipant({
      participant,
      ids: { survivorId, loserId, mergeId },
      ...(c.batchSize !== undefined ? { batchSize: c.batchSize } : {}),
      seed: async (ids) => {
        await c.seed(ids);
        await refreshAudit();
      },
      snapshot: c.snapshot,
      enterScope: (reason, run) => withSystemScope(reason, run),
      events: () => emitted,
      audit: { entries: () => audit, ...(c.sentinels ? { sentinels: c.sentinels } : {}) },
      injectFailure: {
        arm: () => {
          pending = mergeSql(
            h,
            `create trigger "${trigger}" before ${c.failOn.on} on "${c.failOn.table}"
               for each row when (${c.failOn.when(loserId)}) execute function "merge_participant_injected_failure"()`,
          );
        },
        disarm: () => {
          pending = mergeSql(h, `drop trigger if exists "${trigger}" on "${c.failOn.table}"`);
        },
      },
    });
    return { survivorId, loserId, mergeId, ...result };
  } finally {
    bus.emit = emit;
    await pending.catch(() => undefined);
    await mergeSql(h, `drop trigger if exists "${trigger}" on "${c.failOn.table}"`);
  }
}
