# Contract: the command-middleware API

The stable surface of the command-middleware point (D-296.1 – D-296.3). Names given here are the
ones `specs/190-overlay-full-modules/` documents. Rename none of them without updating 190.

Status: **proposed**. It becomes binding when P1 merges.

## 1. Manifest declaration (`@endora-commerce/contracts`, `src/command-middleware.ts`)

```ts
export const COMMAND_MIDDLEWARE_PHASES = ['admit', 'observe'] as const;
export type CommandMiddlewarePhase = (typeof COMMAND_MIDDLEWARE_PHASES)[number];

export const COMMAND_ADMIT_TIMEOUT_DEFAULT_MS = 100;
export const COMMAND_ADMIT_TIMEOUT_MAX_MS = 500;
export const COMMAND_OBSERVE_TIMEOUT_DEFAULT_MS = 1000;
export const COMMAND_OBSERVE_TIMEOUT_MAX_MS = 5000;
export const COMMAND_OBSERVE_MAX_IN_FLIGHT = 1000;

/** A full action (`organization.register`) or a prefix ending in '.' (`organization.`). */
export const commandActionFilterRe = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\.?$/;

export const CommandMiddlewareDeclarationSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    phase: z.enum(COMMAND_MIDDLEWARE_PHASES),
    actions: z.union([z.literal('*'), z.array(z.string().regex(commandActionFilterRe)).min(1)]),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type CommandMiddlewareDeclaration = z.infer<typeof CommandMiddlewareDeclarationSchema>;
```

`ModuleManifestSchema` gains `commandMiddleware: z.array(CommandMiddlewareDeclarationSchema).optional()`.
`defineModuleManifest` adds `assertCommandMiddlewareRules(m)`, which refuses the following and names
the module each time:

1. one `id` declared twice;
2. a `timeoutMs` above its phase's maximum;
3. a filter list with a duplicate, or with an entry already covered by a shorter prefix in the same
   list.

Absent means *"this module contributes no middleware"*, which is true of most modules and is not a
finding.

**What a manifest cannot say.** It cannot state its origin (`contracts/module-origin.md`). The
phase rule for `package` modules is applied during composition, from the derived origin, and never
from the manifest alone.

## 2. Registration (`ModuleContext`)

```ts
commandMiddleware(entries: readonly CommandMiddlewareEntry[]): void;

export type CommandMiddlewareEntry =
  | { readonly id: string; readonly phase: 'admit'; readonly admit: CommandAdmitHandler }
  | { readonly id: string; readonly phase: 'observe'; readonly observe: CommandObserveHandler };
```

- The module id is stamped by the context. It works only during the registration pass, as
  `commandHooks` does. After sealing it throws.
- `SEAM_CLASSIFICATION` in `packages/cli/src/lib/divergence.ts` gains
  `commandMiddleware: { verdict: 'divergence', kind: 'command-middleware', rung: 2 }`. Without it
  the derivation would raise `unclassified-seam`.

## 3. Handler types (`@endora-commerce/platform/commands`)

```ts
export interface CommandAdmissionMeta {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly actor: CommandActor;
  /** The ambient context's organisation when its mode is `single-org`; otherwise null. */
  readonly organizationId: string | null;
  readonly requestMeta: {
    readonly requestId: string | null;
    /** Absent for an observer of origin `package`. */
    readonly ipAddress?: string | null;
    readonly userAgent?: string | null;
  };
  readonly lineage: {
    /** Actions of every Command above this one, root first. Empty for the root. */
    readonly ancestors: readonly string[];
    readonly depth: number;
    /** True when a `beforeCommit` hook started this Command or one above it. */
    readonly viaHook: boolean;
  };
}

export interface CommandMiddlewareCallContext {
  readonly module: { readonly id: string };
  readonly log: PlatformLogger;
}

export type CommandAdmitHandler = (
  meta: CommandAdmissionMeta,
  ctx: CommandMiddlewareCallContext & { readonly signal: AbortSignal },
) => void | Promise<void>;

export interface CommandRunEntry {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly depth: number;
  readonly viaHook: boolean;
  readonly refused: boolean;
  /** True when the bus recorded an audit entry for this Command (and the run committed). */
  readonly audited: boolean;
  /** Per hook module, the sorted field names it noted (`audit-state.md` list 1). */
  readonly notedFields: Readonly<Record<string, readonly string[]>>;
}

export interface CommandRunOutcome {
  readonly root: CommandAdmissionMeta;
  readonly committed: boolean;
  readonly refusal: { readonly middleware: string; readonly code: string } | null;
  /** `HttpError.code` of what the run threw, `'INTERNAL_ERROR'` otherwise, null on commit. */
  readonly errorCode: string | null;
  readonly durationMs: number;
  /** Every Command the run attempted, in the order it attempted them. */
  readonly commands: readonly CommandRunEntry[];
}

export type CommandObserveHandler = (
  outcome: CommandRunOutcome,
  ctx: CommandMiddlewareCallContext,
) => void | Promise<void>;

export class CommandRefusedError extends HttpError {
  constructor(
    code: string,
    options?: { status?: 403 | 409 | 422 | 429 | 503; retryAfterSeconds?: number },
  );
}

/** The middleware currently running on this async path, or undefined. */
export function currentCommandMiddlewareOrigin():
  | { readonly moduleId: string; readonly id: string; readonly phase: CommandMiddlewarePhase }
  | undefined;
```

Every object handed to a handler is frozen. `outcome.root` and every `CommandRunEntry` carry values
from `audit-state.md` list 1 only: ids, codes, booleans, counts and field names.

## 4. What the bus does, in order

For one `CommandBus.run(root)`:

```text
resolveCommandActor()                       (unchanged; fail closed without TenantContext)
re-entry check                              (COMMAND_MIDDLEWARE_REENTRY when inside a middleware)
admit(root)                                 (before the transaction opens)
events.run → forkScopedEm → transactional:
  execute(root):
    [child only] hook-cycle check           (unchanged, 176 FR-022)
    [child only] admit(child)
    assertExtensionsClaimed                 (unchanged, 176 FR-019)
    capture → run (children recurse here)
    beforeCommit hooks                      (unchanged)
    audit entry                             (unchanged)
    buffered event                          (unchanged)
    outbox rows                             (unchanged)
commit or rollback
outbox wake (detached)                      (unchanged)
caller's promise settles
observe(outcome) (detached)                 (also after a refused root)
```

`admit(command)`:

1. When `command.action` is in `ADMISSION_EXEMPT_ACTIONS`, return.
2. For each `admit` entry in composed order whose filter matches `command.action` and whose module
   is present (`isPresent`, asked now), run the handler under `runWithCommandMiddlewareOrigin`,
   raced against its budget, with an `AbortSignal`:
   - it settles: continue;
   - it throws `CommandRefusedError`: record the refusal in the run record, then rethrow it;
   - it throws anything else: record it, log `command.admit.failed` with the label and the error
     class, and throw `COMMAND_ADMISSION_FAILED` (503);
   - the budget expires: abort the signal, log `command.admit.timeout`, and throw
     `COMMAND_ADMISSION_TIMEOUT` (503).
3. Append a `CommandRunEntry` with `refused` set as the outcome dictates.

The filter matches when it is `'*'`, or when the list holds `command.action` itself, or a prefix
ending in `.` that `command.action` starts with.

`observe(outcome)` runs every present `observe` entry whose filter matches **any** entry in
`outcome.commands`. Each runs concurrently under `runWithCommandMiddlewareOrigin` and is raced
against its budget, within its in-flight cap. A failure is logged and swallowed. An observer of
origin `package` receives `root.requestMeta` reduced to `{ requestId }`.

With no middleware registry, or a sealed one with no entries, none of the above allocates or awaits
anything. FR-035 and SC-002 hold this.

## 5. Composition (`CommandMiddlewareRegistry`, `@endora-commerce/platform/composition`)

```ts
export interface CommandMiddlewareCompositionInput {
  /** `commandMiddlewareFrom(manifests)`: every declaration, with its module id. */
  readonly declarations: readonly (CommandMiddlewareDeclaration & { readonly moduleId: string })[];
  /** Each module's transitive dependencies (`moduleDependencyClosureFrom`). */
  readonly moduleDependencies: Readonly<Record<string, readonly string[]>>;
  /** Each composed module's derived origin (`contracts/module-origin.md`). Supplied by the composer. */
  readonly origins: Readonly<Record<string, ModuleOrigin>>;
  /** The deployment's tie-break, from its `divergence.ts`. */
  readonly commandMiddlewareOrder?: readonly string[] | undefined;
}

export class CommandMiddlewareRegistry {
  constructor(options?: { isPresent?: (moduleId: string) => boolean; log?: PlatformLogger });
  register(moduleId: string, entries: readonly CommandMiddlewareEntry[]): void;
  seal(input: CommandMiddlewareCompositionInput): void;
  /** Resolves when no observer is in flight. For tests and graceful shutdown. */
  settled(): Promise<void>;
  /** The composed list, for the boot log line `kernel.command-middleware`. */
  plan(): readonly { moduleId: string; id: string; phase: CommandMiddlewarePhase;
                      origin: ModuleOrigin; position: number | null; actions: '*' | readonly string[] }[];
}
```

`composeModules` seals it after the decoration drain and after the hook registry, before the boot
phase. `ComposeModulesOptions` gains `commandMiddlewareRegistry?` and `commandMiddleware?` (the input
above without `origins`, which the composer adds from its entries). `ComposeAppOptions` gains
`commandMiddlewareOrder?`, read from the same `divergence.ts` as `commandHookOrder`.

Composition refusals, each naming the module, the id and the remedy:

| Error | When |
| --- | --- |
| `UndeclaredCommandMiddlewareError` | a registration with no manifest declaration of that id |
| `UnregisteredCommandMiddlewareError` | a declaration with no registration |
| `CommandMiddlewarePhaseMismatchError` | declaration and registration name different phases |
| `DuplicateCommandMiddlewareError` | one module registers an id twice |
| `CommandMiddlewareOriginError` | an `admit` from a module of origin `package` (cites D-296.3) |
| `UnorderedCommandMiddlewareError` | two overlapping `admit` modules, no path, not both in `commandMiddlewareOrder` |
| `CommandMiddlewareOrderContradictionError` | an order entry contradicting a dependency path |
| `StaleCommandMiddlewareOrderError` | an order entry naming a module that contributes no `admit` |

The ordering function is `orderByModuleGraph` in `packages/platform/src/commands/ordering.ts`.
176's `orderCommandHooks` keeps its signature, delegates to it, and keeps its own error types, so
hook behaviour and messages are unchanged.

## 6. Divergence declaration and report (`@endora-commerce/contracts`, `modules.ts`)

- `DeploymentDivergenceDeclarationSchema` gains
  `commandMiddlewareOrder: z.array(z.string().regex(moduleIdRe)).min(2).optional()`. It is optional,
  not defaulted, for the reason `commandHookOrder` gives: a defaulted field would break every
  scaffolded, typed `divergence.ts`. The `.strict()` comment ("four fields are the whole
  vocabulary") is corrected to count the fields it actually holds.
- `DivergenceKind` gains `'command-middleware'`, with detail
  `{ kind: 'command-middleware'; phase: 'admit' | 'observe'; id: string; actions: '*' | readonly string[] }`.
  The key is `command-middleware:<module>:<id>`. The owner is `null` (the subject is the bus).
  The rung is 2.
- `check:divergence` adds two findings: `stale-middleware-order` (an order entry naming no `admit`
  contributor of this deployment) and `incomplete-middleware-order` (an order entry naming one
  module of a tie).

## 7. Error codes (`ERROR_CODES` in `packages/contracts/src/errors.ts`; translated in `packages/modules/_i18n/i18n/{en,pl}.json`)

| Code | Status | Meaning |
| --- | --- | --- |
| `COMMAND_ADMISSION_TIMEOUT` | 503 | An admission rule did not answer in time; nothing was written. |
| `COMMAND_ADMISSION_FAILED` | 503 | An admission rule failed; nothing was written. |
| `COMMAND_MIDDLEWARE_REENTRY` | 500 | A command middleware tried to run a Command. |

A contributor's own refusal codes are declared in its manifest's `errorCodes`, with pl and en
translations, as for any module error (feature 090).

## 8. Test kit (`@endora-commerce/test-kit/command-middleware`)

```ts
sealedCommandMiddlewareRegistry(input: {
  declarations: readonly (CommandMiddlewareDeclaration & { moduleId: string })[];
  middleware: readonly { moduleId: string; entries: readonly CommandMiddlewareEntry[] }[];
  moduleDependencies?: Readonly<Record<string, readonly string[]>>;
  origins?: Readonly<Record<string, ModuleOrigin>>;      // default: every module 'core'
  commandMiddlewareOrder?: readonly string[];
  isPresent?: (moduleId: string) => boolean;
}): CommandMiddlewareRegistry;

recordingCommandMiddleware(): {
  readonly admitted: CommandAdmissionMeta[];
  readonly observed: CommandRunOutcome[];
  admit(options?: { id?: string; refuseWhen?: (meta: CommandAdmissionMeta) => CommandRefusedError | undefined }):
    Extract<CommandMiddlewareEntry, { phase: 'admit' }>;
  observe(options?: { id?: string }): Extract<CommandMiddlewareEntry, { phase: 'observe' }>;
};

/** Fails with composition's own message when declaration and registration disagree,
 *  or when the declared phases are not allowed for `origin`. */
expectCommandMiddleware(
  manifest: Pick<ModuleManifest, 'id' | 'commandMiddleware' | 'errorCodes'>,
  entries: readonly CommandMiddlewareEntry[],
  options?: { origin?: ModuleOrigin },
): void;
```

```ts
/** Fails unless `error` is a CommandRefusedError whose code `manifest.errorCodes` declares. */
expectDeclaredRefusal(error: unknown, manifest: Pick<ModuleManifest, 'id' | 'errorCodes'>): void;
```

`expectDeclaredRefusal` is the author-side proof that research R-5 (c) relies on: the bus does not
check a refusal's code against the manifest at run time.

## 9. What is deliberately not offered

- No `transform` or `around` phase (D-296.1).
- No `data`, no result and no `em` in `admit` (D-296.2).
- No `admit` from an installed third-party package (D-296.3).
- No operator screen, permission or palette action (research R-18).
- No durable delivery. That is an `afterCommit` hook through the outbox, on an action the owner
  declared, or a read of `audit_log_entries`.
