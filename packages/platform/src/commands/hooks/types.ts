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
 * What the platform's field-rule check is given (`specs/193-admin-form-extensions/`
 * FR-041, `contracts/field-rules.md` §5): the Command's identity, its hook data
 * and its actor. Read only — the check writes nothing, so it gets no `em`.
 */
export interface FieldRuleCheckContext {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly data: unknown;
  readonly actor: CommandActor;
  /**
   * The Command, or one it runs below, declared `buyerSelfService`
   * (D-300.10). The check honours it only for an actor with no acting admin
   * whose kind is `system` or `customer`.
   */
  readonly buyerSelfService: boolean;
}

/** Refuses by throwing; the bus does not catch, so the Command rolls back. */
export type FieldRuleCheck = (ctx: FieldRuleCheckContext) => Promise<void> | void;

/**
 * Where the bus finds the field-rule check of an action: the platform's form
 * registry, attached once per composition. `undefined` for an action no field
 * set lists as a writer, or whose field sets carry no rule — the common case,
 * which then costs one map lookup and changes nothing about the Command.
 */
export interface FieldRuleCheckSource {
  fieldRuleCheck(action: string): FieldRuleCheck | undefined;
}

/**
 * What an `afterCommit` handler receives when the transactional outbox
 * delivers its row (176 P3, FR-032 – FR-034): after the owner's commit, at
 * least once, in a scope pinned to `organizationId` when the row has one.
 * Dedupe on `messageId`; re-read anything beyond `data` through the owner.
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
