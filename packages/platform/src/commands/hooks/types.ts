import type { EntityManager } from '@mikro-orm/postgresql';
import type { HookableActionRef, OutboxData } from '@endora-commerce/contracts';
import type { PlatformLogger } from '../../kernel/logging.js';
import type { Command, CommandActor } from '../command.js';

/**
 * The command-hook types (`specs/176-command-hooks-outbox/`
 * `contracts/command-hooks-api.md` §2, §3) — what a hook author writes against.
 */

/** What a `beforeCommit` hook receives. */
export interface CommandHookContext<TData> {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  /** The owner's declared hook data, typed by the ref. Reflects uncommitted state. */
  readonly data: TData;
  /** `extensions[<this hook's module id>]`, unvalidated: the hook validates it. */
  readonly extension: unknown;
  /** The Command's transaction, tenant-scoped. Write only your own tables on it. */
  readonly em: EntityManager;
  readonly actor: CommandActor;
  readonly module: { readonly id: string };
  /** Run a child Command on the same transaction; it records its own audit entry. */
  run<T>(child: Command<T>): Promise<T>;
  /**
   * The names (never the values) of the fields this hook wrote on its own
   * tables. They land in the owner's single audit entry as
   * `stateAfter.extensions.<moduleId>.changedFields`, sorted and deduplicated.
   */
  noteAuditChanges(fields: readonly string[]): void;
}

export type BeforeCommitHook<TData> = (ctx: CommandHookContext<TData>) => Promise<void> | void;

/**
 * What an `afterCommit` handler will receive once the transactional outbox
 * delivers it (176 P3). Declared now so the ref's `TOutbox` has a reader; the
 * registry refuses an `afterCommit` registration until the outbox ships.
 */
export interface AfterCommitContext<TOutbox extends OutboxData> {
  /** `command_outbox.id` — the idempotency key. */
  readonly messageId: string;
  /** 1-based. */
  readonly attempt: number;
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly organizationId: string | null;
  readonly data: TOutbox;
  readonly causation: {
    /** Recorded at commit; not the context the handler runs in. */
    readonly actor: CommandActor;
    readonly requestId: string | null;
    /** ISO timestamp. */
    readonly committedAt: string;
  };
  readonly log: PlatformLogger;
}

export type AfterCommitHandler<TOutbox extends OutboxData> = (ctx: AfterCommitContext<TOutbox>) => Promise<void>;

type DataOf<R> = R extends HookableActionRef<infer D, OutboxData> ? D : never;
type OutboxOf<R> = R extends HookableActionRef<unknown, infer O> ? O : never;

/**
 * One registration a module hands `ctx.commandHooks`. `id` is kebab-case and
 * unique within the module; the module id is stamped by the context.
 */
// A ref's data types are inferred per entry; `any` is the bound that lets any ref through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommandHookEntry<R extends HookableActionRef<any, any> = HookableActionRef<any, any>> =
  | {
      readonly id: string;
      readonly on: R;
      readonly phase: 'beforeCommit';
      readonly handler: BeforeCommitHook<DataOf<R>>;
    }
  | {
      readonly id: string;
      readonly on: R;
      readonly phase: 'afterCommit';
      readonly handler: AfterCommitHandler<OutboxOf<R>>;
    };
