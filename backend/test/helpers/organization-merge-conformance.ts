import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { MergeParticipant, MergeStepInput } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { AuditSentinel, AuditStateCarrier } from '@endora-commerce/test-kit/audit';
import { expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import type { BackendServerHandle } from './test-server.js';

/**
 * `specs/192-organization-merge/` — `expectMergeParticipant` over a real
 * database, for an Organization participant (`contracts/merge-participant.md`
 * §3), plus the fixtures every DB-backed merge test shares. The module
 * packages' co-located tests use test-kit's in-memory world
 * (`createMemoryMergeWorld`) instead; this is the backend's half.
 *
 * What it adds to the platform-free helper, once for every participant:
 *
 *  - **scope** — every call runs under the merge's system scope, as the runner
 *    calls it;
 *  - **events** — the composition's `EventBus` is counted around the step;
 *  - **audit** — the step's entries are read back from `audit_log_entries` by
 *    merge id after every batch, so the helper's synchronous read sees what the
 *    batch committed (SC-004);
 *  - **registration** — the composed registry holds a participant under the
 *    declared key, so the manifest declaration and `ctx.merge.participate`
 *    agree.
 *
 * Two entry points differ only in which participant runs and how a failure is
 * injected between its survivor-side write and its loser-side consume:
 *
 *  - {@link expectComposedOrganizationParticipant} runs the participant **the
 *    composition registered** and injects the failure with a row trigger on
 *    the table the batch consumes last, narrowed to the loser's rows;
 *  - {@link expectOrganizationParticipantConforms} runs a participant **the
 *    test builds** over a wrapped Command Bus, which throws after the
 *    Command's writes and before its commit.
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

/** A live company Organization written straight to its table (its predefined roles come with it). */
export async function insertCompanyOrganization(h: BackendServerHandle, name = 'Merge Co'): Promise<string> {
  const id = randomUUID();
  await mergeSql(
    h,
    `insert into "organizations"
       ("id","name","tax_id","status","vat_status","is_personal","registered_address","path",
        "custom_field_values","order_confirmation_emails","created_at","updated_at")
     values (?, ?, ?, 'active', 'vat_payer', false,
             '{"street":"ul. Prosta 1","city":"Łódź","postalCode":"90-001","country":"PL"}'::jsonb,
             ?, '{}'::jsonb, '[]'::jsonb, now(), now())`,
    [id, `${name} ${id.slice(0, 6)}`, `MG${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`, `/${id}/`],
  );
  return id;
}

/** Two company Organizations: the one that stays and the duplicate merged into it. */
export async function insertOrganizationPair(h: BackendServerHandle): Promise<{ survivorId: string; loserId: string }> {
  return { survivorId: await insertCompanyOrganization(h, 'Survivor'), loserId: await insertCompanyOrganization(h, 'Loser') };
}

/** The participant a module registered for the Organization host under `key`. */
export function composedOrganizationParticipant(h: BackendServerHandle, moduleId: string, key: string): MergeParticipant<'organization'> {
  const found = h.recordMergeRuntime.registry
    .participantsOf('organization')
    .find((entry) => entry.moduleId === moduleId && entry.key === key);
  if (!found) throw new Error(`no composed Organization merge participant ${moduleId}/${key}`);
  return found.participant as MergeParticipant<'organization'>;
}

interface ConformanceRun {
  readonly h: BackendServerHandle;
  readonly participant: MergeParticipant<'organization'>;
  readonly ids: { readonly survivorId: string; readonly loserId: string; readonly mergeId: string };
  readonly seed: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<void>;
  readonly snapshot: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<unknown>;
  readonly batchSize?: number | undefined;
  readonly hostContext?: Readonly<Record<string, unknown>> | undefined;
  readonly countEvents: boolean;
  readonly sentinels?: readonly AuditSentinel[] | undefined;
  readonly injectFailure: { readonly arm: () => void; readonly disarm: () => void };
  /** Awaited before every participant call: a seam whose `arm` / `disarm` is asynchronous settles here. */
  readonly settled?: () => Promise<void>;
}

/** The shared core: audit read back by merge id, events counted, scope entered. */
async function runConformance(run: ConformanceRun): Promise<{ readonly moved: number; readonly batches: number }> {
  const { h, ids } = run;
  const settled = run.settled ?? (async () => undefined);
  const entries: AuditStateCarrier[] = [];
  const reload = async (): Promise<void> => {
    const rows = await mergeSql<Array<{ action: string; state_before: unknown; state_after: unknown }>>(
      h,
      `select "action", "state_before", "state_after" from "audit_log_entries"
        where "state_after" ->> 'mergeId' = ? order by "acted_at", "id"`,
      [ids.mergeId],
    );
    entries.splice(
      0,
      entries.length,
      ...rows.map((row) => ({
        action: row.action,
        stateBefore: (row.state_before ?? null) as AuditStateCarrier['stateBefore'],
        stateAfter: (row.state_after ?? null) as AuditStateCarrier['stateAfter'],
      })),
    );
  };
  const real = run.participant;
  const participant: MergeParticipant<'organization'> = {
    host: 'organization',
    preview: async (input) => {
      await settled();
      return real.preview(input);
    },
    applyBatch: async (input: MergeStepInput) => {
      await settled();
      try {
        return await real.applyBatch(input);
      } finally {
        await reload();
      }
    },
  };

  let events = 0;
  const emit = h.eventBus.emit;
  h.eventBus.emit = ((...args: Parameters<typeof emit>) => {
    events += 1;
    return emit.apply(h.eventBus, args);
  }) as typeof h.eventBus.emit;
  try {
    return await expectMergeParticipant({
      participant,
      ids,
      ...(run.batchSize !== undefined ? { batchSize: run.batchSize } : {}),
      ...(run.hostContext !== undefined ? { hostContext: run.hostContext } : {}),
      seed: async (pair) => {
        await run.seed(pair);
        await reload();
      },
      snapshot: run.snapshot,
      enterScope: (reason, call) => withSystemScope(reason, call),
      ...(run.countEvents ? { events: () => events } : {}),
      audit: { entries: () => entries, ...(run.sentinels ? { sentinels: run.sentinels } : {}) },
      injectFailure: run.injectFailure,
    });
  } finally {
    h.eventBus.emit = emit;
  }
}

// --- the composed participant, failure by row trigger ----------------------------------------

export interface ComposedParticipantCase {
  readonly moduleId: string;
  readonly key: string;
  /** The module's batch Command action: every entry the step writes under the merge id is one. */
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
  const participant = composedOrganizationParticipant(h, c.moduleId, c.key);
  const { survivorId, loserId } = await insertOrganizationPair(h);
  const mergeId = randomUUID();

  // `arm` / `disarm` are synchronous in the helper's contract; the trigger DDL
  // they issue is awaited before the participant's next call.
  let pending: Promise<unknown> = Promise.resolve();
  const trigger = `merge_participant_fail_${c.failOn.table}`.slice(0, 60);
  await mergeSql(
    h,
    `create or replace function "merge_participant_injected_failure"() returns trigger language plpgsql as $$
       begin raise exception 'injected merge participant failure'; end $$`,
  );
  try {
    const result = await runConformance({
      h,
      participant,
      ids: { survivorId, loserId, mergeId },
      seed: c.seed,
      snapshot: c.snapshot,
      batchSize: c.batchSize,
      countEvents: true,
      sentinels: c.sentinels,
      settled: async () => {
        await pending;
      },
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
    const actions = await mergeSql<Array<{ action: string }>>(
      h,
      `select distinct "action" from "audit_log_entries" where "state_after" ->> 'mergeId' = ?`,
      [mergeId],
    );
    expect(actions.map((row) => row.action), `${c.moduleId}/${c.key} audits its step as ${c.action}`).toEqual([c.action]);
    return { survivorId, loserId, mergeId, ...result };
  } finally {
    await pending.catch(() => undefined);
    await mergeSql(h, `drop trigger if exists "${trigger}" on "${c.failOn.table}"`);
  }
}

// --- a participant the test builds, failure by wrapped Command Bus ---------------------------

export interface OrganizationParticipantConformance {
  readonly h: BackendServerHandle;
  readonly moduleId: string;
  readonly key: string;
  /** Build the participant under test over the bus it is handed. */
  readonly build: (commandBus: Pick<CommandBus, 'run'>) => MergeParticipant<'organization'>;
  readonly seed: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<void>;
  readonly snapshot: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<unknown>;
  /** `mergeId` defaults to a fresh one; a participant that reads its merge's record is handed the one it began. */
  readonly ids: { readonly survivorId: string; readonly loserId: string; readonly mergeId?: string };
  readonly batchSize?: number;
  readonly hostContext?: Readonly<Record<string, unknown>>;
  /** `false` for a participant whose Command publishes an event by contract (members, R-5). */
  readonly countEvents?: boolean;
  readonly sentinels?: readonly AuditSentinel[];
}

export async function expectOrganizationParticipantConforms(
  options: OrganizationParticipantConformance,
): Promise<{ readonly moved: number; readonly batches: number; readonly mergeId: string }> {
  const { h } = options;
  const composed = h.recordMergeRuntime.registry
    .participantsOf('organization')
    .find((participant) => participant.moduleId === options.moduleId && participant.key === options.key);
  expect(composed, `no composed participant ${options.moduleId}/${options.key}`).toBeDefined();

  const bus = h.container.cradle as unknown as { commandBus: CommandBus };
  let armed = false;
  const wrapped: Pick<CommandBus, 'run'> = {
    run<T>(command: Command<T>): Promise<T> {
      if (!armed) return bus.commandBus.run(command);
      return bus.commandBus.run<T>({
        ...command,
        run: async (ctx) => {
          await command.run(ctx);
          throw new Error('injected merge-step failure');
        },
      });
    },
  };
  const mergeId = options.ids.mergeId ?? randomUUID();
  const outcome = await runConformance({
    h,
    participant: options.build(wrapped),
    ids: { survivorId: options.ids.survivorId, loserId: options.ids.loserId, mergeId },
    seed: options.seed,
    snapshot: options.snapshot,
    batchSize: options.batchSize,
    hostContext: options.hostContext,
    countEvents: options.countEvents !== false,
    sentinels: options.sentinels,
    injectFailure: {
      arm: () => {
        armed = true;
      },
      disarm: () => {
        armed = false;
      },
    },
  });
  return { ...outcome, mergeId };
}
