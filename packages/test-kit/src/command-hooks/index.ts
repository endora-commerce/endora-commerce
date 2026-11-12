/**
 * `@endora-commerce/test-kit/command-hooks` — the owner-side proof for a
 * hookable Command, and a recording hook for the hook-author side
 * (`specs/176-command-hooks-outbox/` T027, T036; research R-19).
 *
 * There is no static check for "a Command declared hookable supplies its
 * data": the bus refuses one that does not at run time
 * (`500 COMMAND_HOOK_DATA_MISSING`), and this helper turns that refusal into a
 * red test in the owner's own suite. `contracts/command-hooks-api.md` §6 asks
 * every owner to call it from each declared Command's tests.
 */

import { AssertionError } from 'node:assert';
import type { HookableActionRef, OutboxData } from '@endora-commerce/contracts';
import type { Command, CommandHookContext, CommandHookEntry } from '@endora-commerce/platform/commands';
import { CommandHookRegistry } from '@endora-commerce/platform/composition';

export interface ExpectHookableCommandOptions<TResult> {
  /**
   * A result to feed `hookData` and `outboxData`. With it the helper also holds
   * the outbox data to `audit-state.md` list 1 — scalars or arrays of scalars,
   * never a nested object — and to the sentinels below.
   */
  readonly result?: TResult;
  /** Values that must not appear in the outbox data (a name, a tax id, an e-mail). */
  readonly sentinels?: readonly string[];
}

function fail(message: string): never {
  throw new AssertionError({ message });
}

/**
 * Fail unless `command` is a Command `ref` may be hooked on: same action and
 * object type, `hookData` for a `beforeCommit` declaration, `outboxData` for an
 * `afterCommit` one, and — given a result — outbox data that is list 1 only.
 */
export function expectHookableCommand<TResult>(
  command: Command<TResult>,
  ref: HookableActionRef<unknown, OutboxData>,
  options: ExpectHookableCommandOptions<TResult> = {},
): void {
  if (command.action !== ref.action) {
    fail(`expectHookableCommand: the Command's action is '${command.action}', the ref declares '${ref.action}'.`);
  }
  if (command.objectType !== ref.objectType) {
    fail(
      `expectHookableCommand: '${ref.action}' declares object type '${ref.objectType}', the Command ` +
        `records '${command.objectType}'.`,
    );
  }
  if (ref.phases.includes('beforeCommit') && typeof command.hookData !== 'function') {
    fail(
      `expectHookableCommand: '${ref.action}' is declared hookable for beforeCommit and the Command ` +
        'supplies no hookData — the bus answers every hooked run with 500 COMMAND_HOOK_DATA_MISSING.',
    );
  }
  if (ref.phases.includes('afterCommit') && typeof command.outboxData !== 'function') {
    fail(
      `expectHookableCommand: '${ref.action}' is declared hookable for afterCommit and the Command ` +
        'supplies no outboxData.',
    );
  }
  if (!('result' in options)) return;
  const result = options.result as TResult;
  if (command.hookData) command.hookData(result);
  if (!command.outboxData) return;
  const data = command.outboxData(result);
  const scalar = (value: unknown): boolean =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value);
  for (const [key, value] of Object.entries(data)) {
    const ok = Array.isArray(value) ? value.every(scalar) : scalar(value);
    if (!ok) {
      fail(
        `expectHookableCommand: '${ref.action}' outbox data '${key}' is not a scalar or an array of ` +
          'scalars. Outbox rows carry ids, codes, booleans, counts, dates and field names ' +
          '(specs/conventions/audit-state.md list 1); a handler re-reads anything else through the owner.',
      );
    }
  }
  const serialised = JSON.stringify(data);
  for (const sentinel of options.sentinels ?? []) {
    if (serialised.includes(sentinel)) {
      fail(`expectHookableCommand: '${ref.action}' outbox data carries the sentinel ${JSON.stringify(sentinel)}.`);
    }
  }
}

/** One call a recording hook saw. */
export interface RecordedCommandHookCall {
  readonly action: string;
  readonly objectId: string;
  readonly data: unknown;
  readonly extension: unknown;
}

export interface RecordingCommandHooks {
  /** Every call, in order, across every entry this recorder built. */
  readonly calls: RecordedCommandHookCall[];
  /**
   * A `beforeCommit` entry on `ref` that records its call and then runs `then`
   * (which may write, run a child or veto). Hand the result to `ctx.commandHooks`.
   */
  on<TData>(
    ref: HookableActionRef<TData, OutboxData>,
    options?: { readonly id?: string; readonly then?: (ctx: CommandHookContext<TData>) => Promise<void> | void },
  ): Extract<CommandHookEntry<HookableActionRef<TData, OutboxData>>, { phase: 'beforeCommit' }>;
}

/** A recorder for a fixture hook module's `beforeCommit` hooks. */
export function recordingCommandHooks(): RecordingCommandHooks {
  const calls: RecordedCommandHookCall[] = [];
  return {
    calls,
    on(ref, options = {}) {
      return {
        id: options.id ?? `record-${ref.action.replace(/[._]+/g, '-')}`,
        on: ref,
        phase: 'beforeCommit',
        handler: async (ctx) => {
          calls.push({ action: ref.action, objectId: ctx.objectId, data: ctx.data, extension: ctx.extension });
          await options.then?.(ctx);
        },
      };
    },
  };
}

/** What {@link sealedCommandHookRegistry} composes: the declarations, the graph and the hooks. */
export interface SealedCommandHookRegistryInput {
  /** The owners' declarations, as `hookableActionsFrom(manifests)` derives them. */
  readonly hookableActions: ReadonlyArray<{
    readonly moduleId: string;
    readonly action: string;
    readonly objectType: string;
    readonly phases: ReadonlyArray<'beforeCommit' | 'afterCommit'>;
  }>;
  /** Each hook module's transitive dependencies; the owner must be among them. */
  readonly moduleDependencies: Readonly<Record<string, readonly string[]>>;
  /** The hooks, per registering module, in registration order. */
  readonly hooks: ReadonlyArray<{ readonly moduleId: string; readonly entries: readonly CommandHookEntry[] }>;
  readonly commandHookOrder?: Readonly<Record<string, readonly string[]>>;
  /** Presence per call; defaults to every module present. */
  readonly isPresent?: (moduleId: string) => boolean;
}

/**
 * A command-hook registry composed and sealed the way `composeModules` seals
 * the platform's — for an owner's unit test that runs its Command on a real
 * `CommandBus` (`new CommandBus(orm, audit, events, { hooks })`) without
 * composing the platform. Every composition refusal is the platform's own.
 */
export function sealedCommandHookRegistry(input: SealedCommandHookRegistryInput): CommandHookRegistry {
  const registry = new CommandHookRegistry(input.isPresent ? { isPresent: input.isPresent } : {});
  for (const { moduleId, entries } of input.hooks) registry.register(moduleId, entries);
  registry.seal({
    hookableActions: input.hookableActions.map((declaration) => ({ ...declaration, phases: [...declaration.phases] })),
    moduleDependencies: input.moduleDependencies,
    commandHookOrder: input.commandHookOrder ?? {},
  });
  return registry;
}
