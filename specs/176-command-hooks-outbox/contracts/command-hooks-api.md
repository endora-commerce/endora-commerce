# Contract: the command-hook API (stable surface for 177, 178 and instance packages)

**Status**: the names and shapes below are the contract `specs/177-tax-id-scope/` and
`specs/178-extensible-columns/` may depend on. Changing one after P2 merges is a changeset on the
owning package (minor while in `0.x`, with the old/new call in the body).

**Amended (P2, 2026-11-12)** — reconciled with `master` and the conventions while implementing;
master won in each case:

1. **Error-code owner.** The three codes are declared by `_i18n`, the platform-vocabulary owner
   (`packages/modules/_i18n/src/manifest.ts`, which records why `_lifecycle` was refused for that
   role), not by `_lifecycle`. They are also in `ERROR_CODES`, so `HttpError` accepts them.
2. **`commandHookOrder` is `.optional()`, not `.default({})`.** A defaulted field is a required
   member of the inferred `DeploymentDivergenceDeclaration`, and every instance's typed
   `divergence.ts` would stop compiling on upgrade. Absent means `{}`.
3. **`afterCommit` is types only in P2.** `AfterCommitContext` / `AfterCommitHandler` ship and a ref
   names both phases, but registering an `afterCommit` handler throws until P3's outbox delivers it
   — accepting one would be a handler nothing calls. `PermanentOutboxFailure` is P3's.
   *Superseded by P3 (2026-11-12):* registration is accepted and delivered through the outbox, and
   `PermanentOutboxFailure` is on `./commands`. `CommandBusOptions` gains `outboxWake`. See the
   amendment block in `outbox-and-admin-api.md`.
4. **§4.3 reads "present", not "registered".** `COMMAND_HOOK_DATA_MISSING` is raised when at least
   one hook whose module is present would run: with every hook module off, the Command behaves as
   if they were not installed (Principle XVII). `expectHookableCommand` is what makes a missing
   `hookData` red in the owner's own suite.
5. **The registry lives on `./composition`** (`CommandHookRegistry`, `hookableActionsFrom`,
   `moduleDependencyClosureFrom`); a root builds it, a module never does. `composeModules` takes it
   as `commandHookRegistry` (the field name the context option has, which `harness-parity.test.ts`
   requires) plus the data as `commandHooks`. A module's unit test seals one through
   `@endora-commerce/test-kit/command-hooks`' `sealedCommandHookRegistry`.
6. **Cycle bound is for hook-induced nesting only**: an owner's own `ctx.run` children are not
   limited, as before hooks existed; a chain that passed through a hook refuses a repeated action
   or a ninth Command.
7. **`noteAuditChanges` refuses a non-field-name** (`/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/`),
   so the names-only rule (`specs/conventions/audit-state.md`, which now names the key) holds for
   hooks. **A hook's notes force the entry** (architect ruling on #1055): when the owner answers
   `skipAudit` and at least one hook noted a write, the bus still records the one entry, with
   `stateBefore: null` and `stateAfter: { extensions }` — the hooks' names and nothing of the
   owner's. With `skipAudit` and no notes, no entry is recorded, as before.

## 1. `@endora-commerce/contracts` — `src/command-hooks.ts` (platform-free)

```ts
export type CommandHookPhase = 'beforeCommit' | 'afterCommit';

/** Scalars allowed in outbox data: audit-state.md list 1 only. */
export type OutboxScalar = string | number | boolean | null;
export type OutboxData = Readonly<Record<string, OutboxScalar | readonly OutboxScalar[]>>;

/** A hookable action, published by its owner. TData: beforeCommit data (in memory, never stored).
 *  TOutbox: afterCommit data (stored in command_outbox). */
export interface HookableActionRef<TData = unknown, TOutbox extends OutboxData = OutboxData> {
  readonly action: string;                       // e.g. 'organization.create'
  readonly objectType: string;                   // e.g. 'organization'
  readonly phases: readonly CommandHookPhase[];
  /** Phantom carrier for the two data types; never set at run time. */
  readonly __types?: { readonly data: TData; readonly outbox: TOutbox };
}

export function hookableAction<TData, TOutbox extends OutboxData = OutboxData>(
  action: string, objectType: string, phases: readonly CommandHookPhase[],
): HookableActionRef<TData, TOutbox>;

/** Manifest entry, derived from a ref. */
export const HookableActionDeclarationSchema: z.ZodObject<{
  action; objectType; phases: z.array(z.enum(['beforeCommit','afterCommit'])).min(1)
}>;
export function toHookableActionDeclaration(ref: HookableActionRef): HookableActionDeclaration;
```

`ModuleManifestSchema` gains `hookableActions: z.array(HookableActionDeclarationSchema).optional()`.
`defineModuleManifest` refuses a duplicate action within one manifest. `DivergenceKind` gains
`'command-hook'`. `DeploymentDivergenceDeclarationSchema` gains
`commandHookOrder: z.record(action, z.array(moduleId).min(2)).default({})` (OD-1).

Error codes (platform-owned, declared by `_lifecycle`, translated pl+en under `errors.<CODE>`):
`COMMAND_EXTENSION_UNCLAIMED` (422, `details: [{ path: 'extensions.<key>', issue }]`),
`COMMAND_HOOK_CYCLE` (500), `COMMAND_HOOK_DATA_MISSING` (500).

## 2. `@endora-commerce/platform/commands` — additions to the published barrel

```ts
// Command<TResult> gains three optional members:
interface Command<TResult> {
  /** Required when `action` is declared hookable with 'beforeCommit'. */
  hookData?(result: TResult): unknown;
  /** Required when declared with 'afterCommit'. List-1 values only. */
  outboxData?(result: TResult): OutboxData & { readonly organizationId?: string | null };
  /** Caller-supplied extension input keyed by module id; each hook sees only its own key. */
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface CommandHookContext<TData> {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly data: TData;
  /** extensions[<this hook's module id>], unvalidated; the hook validates it. */
  readonly extension: unknown;
  readonly em: EntityManager;          // the Command's transaction, tenant-scoped
  readonly actor: CommandActor;
  readonly module: { readonly id: string };
  /** Child Command on the same transaction; own audit entry. */
  run<T>(child: Command<T>): Promise<T>;
  /** Names (never values) of fields this hook wrote on its own tables; lands in the owner's
   *  single audit entry as stateAfter.extensions.<moduleId>.changedFields (sorted, deduped). */
  noteAuditChanges(fields: readonly string[]): void;
}
export type BeforeCommitHook<TData> = (ctx: CommandHookContext<TData>) => Promise<void> | void;

export interface AfterCommitContext<TOutbox extends OutboxData> {
  readonly messageId: string;          // command_outbox.id — the idempotency key
  readonly attempt: number;            // 1-based
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly organizationId: string | null;
  readonly data: TOutbox;
  readonly causation: {
    readonly actor: CommandActor;      // recorded at commit; NOT the context the handler runs in
    readonly requestId: string | null;
    readonly committedAt: string;      // ISO
  };
  readonly log: PlatformLogger;
}
export type AfterCommitHandler<TOutbox extends OutboxData> =
  (ctx: AfterCommitContext<TOutbox>) => Promise<void>;

/** Throw from a handler to dead-letter at once (no retry). `code` is a code-shaped string. */
export class PermanentOutboxFailure extends Error { constructor(readonly code: string, message: string); }

/** Optional readability subclass of HttpError for a veto; any HttpError works. */
export class CommandHookRefusal extends HttpError {}

/** The hook currently running on this async path (and its children), else undefined. */
export function currentCommandHookOrigin():
  { readonly moduleId: string; readonly hookId: string; readonly action: string } | undefined;

// Composition errors (thrown while sealing the registry, before boot hooks):
export class UndeclaredHookableActionError extends Error {}   // action not declared by any module
export class HookPhaseNotOfferedError extends Error {}        // phase not in the declaration
export class DuplicateHookableActionError extends Error {}    // two owners declare one action
export class DuplicateCommandHookError extends Error {}       // same (module, id)
export class HookOwnerNotDependedOnError extends Error {}     // owner not in transitive dependencies
export class UnorderedCommandHooksError extends Error {}      // no path, no commandHookOrder entry
export class CommandHookOrderContradictionError extends Error {}
```

## 3. `@endora-commerce/platform/kernel` — `ModuleContext` gains one seam

```ts
commandHooks(entries: readonly CommandHookEntry[]): void;

type CommandHookEntry =
  | { id: string; on: HookableActionRef<infer D, any>; phase: 'beforeCommit'; handler: BeforeCommitHook<D> }
  | { id: string; on: HookableActionRef<any, infer O>; phase: 'afterCommit';  handler: AfterCommitHandler<O> };
```

`id` is kebab-case, unique per module. The module id is stamped by the context. Calling it after
composition is sealed throws (as interceptors do after ready). Registration resolves nothing.

## 4. Run-time semantics (normative)

1. Per executed Command (parent or child) whose action is declared: after `run` returns, the bus
   takes the ordered `beforeCommit` hooks, drops those whose module `isPresent` is false, and runs
   each in order with `currentCommandHookOrigin()` set.
2. Before any hook runs, every key of `command.extensions` must belong to a present hook module on
   this action (either phase), else `422 COMMAND_EXTENSION_UNCLAIMED`.
3. A missing `hookData`/`outboxData` for a declared phase with at least one registered hook →
   `500 COMMAND_HOOK_DATA_MISSING`.
4. A throw from a hook propagates unchanged (HttpError → its status/code; other → 500); the
   transaction rolls back.
5. Then the owner's audit entry is recorded with `extensions.<moduleId>.changedFields` merged into
   `stateAfter` (only when a hook noted changes; `stateAfter: null` becomes `{ extensions }`). The
   entry is recorded when `!skipAudit || anyNotes`: an owner that answered `skipAudit` while a hook
   noted a write gets one entry with `stateBefore: null` and `stateAfter: { extensions }`.
6. Then one `command_outbox` row per present `afterCommit` handler is persisted on the same `em`.
7. After commit the bus enqueues the deduplicated wake job if rows were written (failure ignored).
8. Nesting: an action may not appear twice in the chain of Commands run from hooks; depth ≤ 8.
   Either violation → `500 COMMAND_HOOK_CYCLE`.

## 5. Rules for hook authors

- Write only your own module's tables, or run the owner's Command through `ctx.run`. Never another
  module's table (Principle I). Call `noteAuditChanges` for every direct write.
- Declare the owning module in your manifest `dependencies`.
- Declare and translate (pl+en) every error code you veto with.
- Do not call remote services in `beforeCommit` — the transaction is open. Use `afterCommit`.
- `afterCommit` handlers are at-least-once: dedupe on `messageId`; re-read state through owner ports.

## 6. Rules for owners declaring an action

- Declare only Commands whose `run` is complete and whose audit entry is the one you want hooked.
- Never declare a reversible Command.
- Publish the ref in `@endora-commerce/contracts`, list it in the manifest, supply `hookData`
  and `outboxData`, and add `expectHookableCommand(command, ref)` (from `@endora-commerce/test-kit`)
  to the Command's tests.
- The action string, the phases and the data types are a public contract: changing one is a
  changeset.

## 7. Example (an instance package)

```ts
import { ORGANIZATION_HOOKABLE_ACTIONS as ORG } from '@endora-commerce/contracts';

export function registerModule(ctx: ModuleContext): void {
  ctx.commandHooks([
    {
      id: 'refuse-unserved-country',
      on: ORG.register,
      phase: 'beforeCommit',
      handler: ({ data }) => {
        if (!SERVED.has(data.organization.registeredAddress.country)) {
          throw new CommandHookRefusal(409, 'ACME_COUNTRY_NOT_SERVED', 'We do not serve this country.');
        }
      },
    },
    { id: 'notify-erp', on: ORG.register, phase: 'afterCommit', handler: notifyErp },
  ]);
}
```
