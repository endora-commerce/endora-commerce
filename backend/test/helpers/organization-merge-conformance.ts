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
 * §3). What this adds to the platform-free helper is the backend's half:
 *
 *  - the participant under test is built by the test over a **wrapped**
 *    Command Bus, so a failure can be injected after the Command's writes and
 *    before its commit — the rollback the helper asserts;
 *  - the audit entries the step wrote are read back from `audit_log_entries`
 *    by merge id after every batch (the helper reads them synchronously);
 *  - events are counted on the harness's `EventBus`;
 *  - every call runs inside the merge's system scope, as the runner runs it;
 *  - the composed registry holds a participant under the declared key, so the
 *    manifest declaration and `ctx.merge.participate` agree.
 */
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
  const real = options.build(wrapped);
  const mergeId = options.ids.mergeId ?? randomUUID();

  const entries: AuditStateCarrier[] = [];
  const reload = async (): Promise<void> => {
    const rows = await h
      .em()
      .fork()
      .getConnection()
      .execute<Array<{ action: string; state_before: unknown; state_after: unknown }>>(
        `select "action", "state_before", "state_after" from "audit_log_entries"
          where "state_after" ->> 'mergeId' = ? order by "acted_at", "id"`,
        [mergeId],
      );
    entries.splice(
      0,
      entries.length,
      ...rows.map((row) => ({
        action: row.action,
        stateBefore: row.state_before as Record<string, unknown> | null,
        stateAfter: row.state_after as Record<string, unknown> | null,
      })),
    );
  };
  const participant: MergeParticipant<'organization'> = {
    host: 'organization',
    preview: (input) => real.preview(input),
    applyBatch: async (input: MergeStepInput) => {
      try {
        return await real.applyBatch(input);
      } finally {
        await reload();
      }
    },
  };

  let events = 0;
  const emit = h.eventBus.emit.bind(h.eventBus);
  h.eventBus.emit = ((name: string, payload: never) => {
    events += 1;
    emit(name, payload);
  }) as typeof h.eventBus.emit;
  try {
    const outcome = await expectMergeParticipant({
      participant,
      seed: options.seed,
      snapshot: options.snapshot,
      ids: { survivorId: options.ids.survivorId, loserId: options.ids.loserId, mergeId },
      ...(options.batchSize !== undefined ? { batchSize: options.batchSize } : {}),
      ...(options.hostContext !== undefined ? { hostContext: options.hostContext } : {}),
      enterScope: (reason, run) => withSystemScope(reason, run),
      ...(options.countEvents === false ? {} : { events: () => events }),
      audit: { entries: () => entries, ...(options.sentinels ? { sentinels: options.sentinels } : {}) },
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
  } finally {
    h.eventBus.emit = emit;
  }
}

/** A company Organization written straight to its table, for a participant test's pair. */
export async function insertCompanyOrganization(h: BackendServerHandle, name = 'Merge Co'): Promise<string> {
  const id = randomUUID();
  await h
    .em()
    .fork()
    .getConnection()
    .execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path",
          "custom_field_values","order_confirmation_emails","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', false,
               '{"street":"ul. Prosta 1","city":"Łódź","postalCode":"90-001","country":"PL"}'::jsonb,
               ?, '{}'::jsonb, '[]'::jsonb, now(), now())`,
      [id, `${name} ${id.slice(0, 6)}`, `MG${id.replace(/-/g, '').slice(0, 14).toUpperCase()}`, `/${id}/`],
    );
  return id;
}

/** Two company Organizations: the one that stays and the duplicate merged into it. */
export async function insertOrganizationPair(h: BackendServerHandle): Promise<{ survivorId: string; loserId: string }> {
  return { survivorId: await insertCompanyOrganization(h, 'Survivor'), loserId: await insertCompanyOrganization(h, 'Loser') };
}
