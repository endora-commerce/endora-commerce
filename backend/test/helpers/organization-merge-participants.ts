import { randomUUID } from 'node:crypto';
import type { MergeParticipant } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { AuditSentinel, AuditStateCarrier } from '@endora-commerce/test-kit/audit';
import { expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import type { BackendServerHandle } from './test-server.js';

/**
 * `specs/192-organization-merge/` Phases 4 – 6 — one Organization participant,
 * as the composition registered it, held to `expectMergeParticipant` over a
 * real database (`contracts/merge-participant.md` §3).
 *
 * The participant is the one `ctx.merge.participate` put in the composed
 * registry, not one built by the test, so the declaration, the registration
 * and the module's own wiring (its Command Bus, its caches) are what runs.
 * The conformance helper's seams are filled here once for every participant:
 *
 *  - **scope** — every call runs under the merge's system scope, as the runner
 *    calls it;
 *  - **events** — the composition's bus is counted around the step;
 *  - **audit** — the step's entries are read back from `audit_log_entries`
 *    (action and survivor id) after every call, so the helper's synchronous
 *    read sees what the batch committed;
 *  - **failure** — a row trigger on the table the batch consumes last
 *    raises while armed, so a batch fails between its survivor-side write and
 *    its loser-side consume and must roll back whole.
 */

export async function mergeSql<T = unknown>(h: BackendServerHandle, statement: string, params: unknown[] = []): Promise<T> {
  return h.em().fork().getConnection().execute(statement, params) as Promise<T>;
}

/**
 * Insert fixture rows with foreign-key triggers off for the one transaction
 * (`session_replication_role = replica`), so a participant's own rows can be
 * seeded without the orders, products or price books they point at. CHECK
 * constraints still hold, and the participant's batch runs with every trigger
 * on — so the rows it moves onto the survivor are checked as in production.
 */
export async function seedRows(h: BackendServerHandle, statements: ReadonlyArray<readonly [string, readonly unknown[]]>): Promise<void> {
  await h.em().fork().transactional(async (em) => {
    await em.execute('set local session_replication_role = replica');
    for (const [statement, params] of statements) await em.execute(statement, [...params]);
  });
}

/** A live company Organization, the minimum the participants' foreign keys need. */
export async function mergeOrganization(h: BackendServerHandle, name = 'Merge participant'): Promise<string> {
  const id = randomUUID();
  await mergeSql(
    h,
    `insert into "organizations"
       ("id","name","tax_id","status","vat_status","is_personal","registered_address","path",
        "custom_field_values","order_confirmation_emails","created_at","updated_at")
     values (?, ?, ?, 'active', 'vat_payer', false,
             '{"street":"ul. Prosta 1","city":"Łódź","postalCode":"90-001","country":"PL"}'::jsonb,
             ?, '{}'::jsonb, '[]'::jsonb, now(), now())`,
    [id, `${name} ${id.slice(0, 6)}`, `MP${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`, `/${id}/`],
  );
  return id;
}

/** The participant a module registered for the Organization host under `key`. */
export function composedOrganizationParticipant(h: BackendServerHandle, moduleId: string, key: string): MergeParticipant<'organization'> {
  const found = h.recordMergeRuntime.registry
    .participantsOf('organization')
    .find((entry) => entry.moduleId === moduleId && entry.key === key);
  if (!found) throw new Error(`no composed Organization merge participant ${moduleId}/${key}`);
  return found.participant as MergeParticipant<'organization'>;
}

export interface ComposedParticipantCase {
  readonly moduleId: string;
  readonly key: string;
  /** The module's batch Command action, whose audit entries are read back. */
  readonly action: string;
  readonly seed: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<void>;
  readonly snapshot: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<unknown>;
  /**
   * The table and statement the batch consumes the loser's state with, and the
   * row condition (on `OLD`) that names the loser's rows; armed, it raises. A
   * row trigger narrowed to the loser, so a test running beside this one in the
   * same database is not touched.
   */
  readonly failOn: { readonly table: string; readonly on: 'UPDATE' | 'DELETE'; readonly when: (loserId: string) => string };
  readonly batchSize?: number;
  readonly sentinels?: readonly AuditSentinel[];
}

export interface ComposedParticipantOutcome {
  readonly survivorId: string;
  readonly loserId: string;
  readonly mergeId: string;
  readonly moved: number;
  readonly batches: number;
}

export async function expectComposedOrganizationParticipant(
  h: BackendServerHandle,
  c: ComposedParticipantCase,
): Promise<ComposedParticipantOutcome> {
  const real = composedOrganizationParticipant(h, c.moduleId, c.key);
  const survivorId = await mergeOrganization(h, 'Survivor');
  const loserId = await mergeOrganization(h, 'Loser');
  const mergeId = randomUUID();

  let audit: AuditStateCarrier[] = [];
  const refreshAudit = async (): Promise<void> => {
    audit = (
      await mergeSql<Array<{ action: string; state_before: unknown; state_after: unknown }>>(
        h,
        `select "action", "state_before", "state_after" from "audit_log_entries"
          where "action" = ? and "object_type" = 'organization' and "object_id" = ? order by "acted_at", "id"`,
        [c.action, survivorId],
      )
    ).map((row) => ({
      action: row.action,
      stateBefore: (row.state_before ?? null) as AuditStateCarrier['stateBefore'],
      stateAfter: (row.state_after ?? null) as AuditStateCarrier['stateAfter'],
    }));
  };
  // `arm` / `disarm` are synchronous in the helper's contract; the trigger DDL
  // they issue is awaited before the participant's next call.
  let pending: Promise<unknown> = Promise.resolve();
  const settled = async (): Promise<void> => {
    await pending;
  };
  const participant: MergeParticipant<'organization'> = {
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

  const trigger = `merge_participant_fail_${c.failOn.table}`.slice(0, 60);
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

