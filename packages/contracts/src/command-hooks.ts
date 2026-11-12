// Command hooks — `specs/176-command-hooks-outbox/` P2 (US2),
// `contracts/command-hooks-api.md` §1.
//
// The platform-free half of the command-hook API: the typed reference an owner
// publishes for each Command action it opens to hooks, the manifest
// declaration derived from it, and the error codes the platform answers a
// misuse with. The platform half — `ctx.commandHooks`, the bus dispatch, the
// hook context — is `@endora-commerce/platform/commands` and `./kernel`.
//
// One constant serves both readers (FR-010): the owner lists the ref in its
// manifest through `toHookableActionDeclaration`, and a hook author imports the
// same ref so the hook's `data` is typed by the owner's declaration.

import { z } from 'zod';

/** When a hook runs relative to the Command's commit. */
export type CommandHookPhase = 'beforeCommit' | 'afterCommit';

export const COMMAND_HOOK_PHASES = ['beforeCommit', 'afterCommit'] as const satisfies readonly CommandHookPhase[];

/**
 * A scalar allowed in outbox data: `specs/conventions/audit-state.md` list 1
 * only — ids, codes, booleans, counts and dates. Never free text, money,
 * personal data or a custom-field value (FR-031).
 */
export type OutboxScalar = string | number | boolean | null;

/** The data an `afterCommit` row carries. Stored in `command_outbox` (P3). */
export type OutboxData = Readonly<Record<string, OutboxScalar | readonly OutboxScalar[]>>;

/**
 * The longest string an outbox value may be. Long enough for a UUID, an ISO
 * timestamp, a dictionary code and a dotted field name
 * (`extensions.<moduleId>.changedFields`); short of anything a sentence needs.
 */
export const OUTBOX_STRING_MAX_LENGTH = 128;

/**
 * Printable ASCII without a space and without `@`: what an id, a code, a date
 * and a field name are made of. `@` is refused because an e-mail address is the
 * one personal datum that otherwise has a code's shape.
 */
const OUTBOX_STRING_RE = /^[\x21-\x3f\x41-\x7e]*$/;

/** One outbox data key that is not `audit-state.md` list 1, and why. Never carries the value. */
export interface OutboxDataViolation {
  readonly key: string;
  readonly issue: 'nested' | 'too-long' | 'not-code-shaped' | 'not-finite' | 'not-a-scalar';
}

function scalarIssue(value: unknown): OutboxDataViolation['issue'] | null {
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'not-finite';
  if (typeof value === 'string') {
    if (value.length > OUTBOX_STRING_MAX_LENGTH) return 'too-long';
    return OUTBOX_STRING_RE.test(value) ? null : 'not-code-shaped';
  }
  if (typeof value === 'object') return 'nested';
  return 'not-a-scalar';
}

/**
 * The keys of `data` that an outbox row may not store (FR-031): a nested
 * object, a string longer than {@link OUTBOX_STRING_MAX_LENGTH} or with
 * whitespace or an `@` in it, a non-finite number, anything that is not a scalar. An
 * array is allowed when every member is. Sorted by key, and the value is never
 * repeated: the answer is what an error message may print.
 *
 * A **structural** guard — it cannot tell a one-word name from a code, and the
 * owner's `outboxData` remains the place list 1 is decided. What it refuses is
 * the shape free text, an address or a snapshot has, so the common mistake
 * fails the Command (and the owner's `expectHookableCommand`) instead of
 * landing in a platform-global table.
 */
export function outboxDataViolations(data: Readonly<Record<string, unknown>>): OutboxDataViolation[] {
  const violations: OutboxDataViolation[] = [];
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    const issue = Array.isArray(value)
      ? (value.map(scalarIssue).find((found) => found !== null) ?? null)
      : scalarIssue(value);
    if (issue !== null) violations.push({ key, issue });
  }
  return violations;
}

/**
 * A hookable action, published by the module that owns the Command.
 *
 * `TData` is what a `beforeCommit` hook receives (in memory, never stored);
 * `TOutbox` is what an `afterCommit` handler receives (stored, list 1 only).
 * Both are carried by the phantom `__types` member, which is never set at run
 * time — it exists so a hook registered with this ref is typed by it.
 */
export interface HookableActionRef<TData = unknown, TOutbox extends OutboxData = OutboxData> {
  /** The Command's audit action, e.g. `organization.create`. */
  readonly action: string;
  /** The Command's audit object type, e.g. `organization`. */
  readonly objectType: string;
  /** The phases the owner offers. A hook for any other phase fails composition. */
  readonly phases: readonly CommandHookPhase[];
  /** Phantom carrier for the two data types; never set at run time. */
  readonly __types?: { readonly data: TData; readonly outbox: TOutbox };
}

/** A Command action: dot-separated lower-case segments, at least two. */
export const hookableActionRe = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const objectTypeRe = /^[a-z][a-z0-9_]*$/;

/**
 * Declare a hookable action. The owner calls this once per action, in
 * `@endora-commerce/contracts`, and exports the result.
 *
 * Refuses a malformed action or object type, and an empty or repeated phase
 * list, at module load — a ref is a public contract and is never built at run
 * time from data.
 */
export function hookableAction<TData, TOutbox extends OutboxData = OutboxData>(
  action: string,
  objectType: string,
  phases: readonly CommandHookPhase[],
): HookableActionRef<TData, TOutbox> {
  const parsed = HookableActionDeclarationSchema.parse({ action, objectType, phases: [...phases] });
  return Object.freeze({
    action: parsed.action,
    objectType: parsed.objectType,
    phases: Object.freeze([...parsed.phases]),
  });
}

/** The manifest entry for one hookable action, derived from its ref. */
export const HookableActionDeclarationSchema = z
  .object({
    action: z.string().regex(hookableActionRe),
    objectType: z.string().regex(objectTypeRe),
    phases: z.array(z.enum(COMMAND_HOOK_PHASES)).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.phases).size !== value.phases.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['phases'],
        message: `hookable action "${value.action}" lists a phase twice`,
      });
    }
  });
export type HookableActionDeclaration = z.infer<typeof HookableActionDeclarationSchema>;

/** What an owner writes in its manifest's `hookableActions`. */
export function toHookableActionDeclaration(ref: HookableActionRef<unknown, OutboxData>): HookableActionDeclaration {
  return { action: ref.action, objectType: ref.objectType, phases: [...ref.phases] };
}

/**
 * The codes the platform answers a command-hook misuse with. Owned by the
 * platform vocabulary (`_i18n`, translated pl + en under `errors.<CODE>`).
 *
 *  - `COMMAND_EXTENSION_UNCLAIMED` (422) — a Command's `extensions` carries a
 *    key no present hook module on that action claims; refused before any
 *    write, `details: [{ path: 'extensions.<key>', issue }]` (FR-019).
 *  - `COMMAND_HOOK_CYCLE` (500) — a hookable action reappears in its own
 *    ancestor chain, or hook-induced nesting passed its bound (FR-022).
 *  - `COMMAND_HOOK_DATA_MISSING` (500) — a Command declared hookable did not
 *    supply its hook data (FR-023).
 */
export const COMMAND_HOOK_ERROR_CODES = {
  EXTENSION_UNCLAIMED: 'COMMAND_EXTENSION_UNCLAIMED',
  CYCLE: 'COMMAND_HOOK_CYCLE',
  DATA_MISSING: 'COMMAND_HOOK_DATA_MISSING',
} as const;

/** How deep hook-induced Command nesting may go: the ninth Command in one chain is refused. */
export const COMMAND_HOOK_MAX_DEPTH = 8;

// ---------------------------------------------------------------------------
// The read-only execution plan (`GET /api/v1/admin/command-hooks`, FR-026/FR-040)
// ---------------------------------------------------------------------------

/** One registered hook, at its position in its action's execution order. */
export const CommandHookPlanItemSchema = z.object({
  action: z.string(),
  phase: z.enum(COMMAND_HOOK_PHASES),
  /** 1-based position within the action and phase. */
  position: z.number().int().positive(),
  module: z.string(),
  id: z.string(),
  /** Whether the hook's module is present on the effective state right now. */
  moduleEnabled: z.boolean(),
});
export type CommandHookPlanItem = z.infer<typeof CommandHookPlanItemSchema>;

/** One action some module declares hookable, whether or not anything hooks it. */
export const CommandHookPlanActionSchema = z.object({
  action: z.string(),
  objectType: z.string(),
  owner: z.string(),
  phases: z.array(z.enum(COMMAND_HOOK_PHASES)),
});
export type CommandHookPlanAction = z.infer<typeof CommandHookPlanActionSchema>;

export const CommandHookPlanResponseSchema = z.object({
  actions: z.array(CommandHookPlanActionSchema),
  items: z.array(CommandHookPlanItemSchema),
});
export type CommandHookPlanResponse = z.infer<typeof CommandHookPlanResponseSchema>;
