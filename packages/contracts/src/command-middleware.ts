// Command middleware — `specs/189-command-middleware/` P1 (ruling D-296),
// `contracts/command-middleware-api.md` §1.
//
// The platform-free half of the command-middleware point: the manifest
// declaration a module writes for each middleware it contributes, the phases,
// the time budgets and the action-filter grammar. The platform half — the
// registry, the handler types, `ctx.commandMiddleware` and what the Command Bus
// does with each phase — is `@endora-commerce/platform/commands` and
// `./composition`.
//
// There are two phases and no others (D-296.1). `admit` lets a Command through
// or refuses it, before it does anything, and sees metadata only (D-296.2).
// `observe` reads a summary of a run after it committed or rolled back. Who may
// contribute which phase is decided at composition from the module's derived
// origin (D-296.3, `contracts/module-origin.md`), never from the manifest.

import { z } from 'zod';

export const COMMAND_MIDDLEWARE_PHASES = ['admit', 'observe'] as const;
export type CommandMiddlewarePhase = (typeof COMMAND_MIDDLEWARE_PHASES)[number];

/**
 * Budgets (research R-8). A child's `admit` runs inside its parent's open
 * transaction, so its cap is low; an `observe` is detached from every writer.
 * Platform constants rather than Settings: no operator has a reason to change
 * them, and a declaration may lower or raise its own budget under the cap.
 */
export const COMMAND_ADMIT_TIMEOUT_DEFAULT_MS = 100;
export const COMMAND_ADMIT_TIMEOUT_MAX_MS = 500;
export const COMMAND_OBSERVE_TIMEOUT_DEFAULT_MS = 1000;
export const COMMAND_OBSERVE_TIMEOUT_MAX_MS = 5000;
/** In-flight `observe` calls per middleware; a call beyond it is dropped and counted (FR-023). */
export const COMMAND_OBSERVE_MAX_IN_FLIGHT = 1000;

/** A full action (`organization.register`) or a prefix ending in '.' (`organization.`). */
export const commandActionFilterRe = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\.?$/;

/** What a middleware runs for: every Command, or the actions and prefixes listed. */
export type CommandActionFilter = '*' | readonly string[];

export const CommandMiddlewareDeclarationSchema = z
  .object({
    /** Kebab-case, unique within the module. */
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    phase: z.enum(COMMAND_MIDDLEWARE_PHASES),
    actions: z.union([z.literal('*'), z.array(z.string().regex(commandActionFilterRe)).min(1)]),
    /** Optional budget, at most the phase's maximum; the phase default applies when absent. */
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type CommandMiddlewareDeclaration = z.infer<typeof CommandMiddlewareDeclarationSchema>;

/** The budget a declaration runs under: its own `timeoutMs`, or the phase default. */
export function commandMiddlewareTimeoutMs(declaration: Pick<CommandMiddlewareDeclaration, 'phase' | 'timeoutMs'>): number {
  if (declaration.timeoutMs !== undefined) return declaration.timeoutMs;
  return declaration.phase === 'admit' ? COMMAND_ADMIT_TIMEOUT_DEFAULT_MS : COMMAND_OBSERVE_TIMEOUT_DEFAULT_MS;
}

/** The largest `timeoutMs` a declaration of `phase` may carry (FR-003). */
export function commandMiddlewareTimeoutMaxMs(phase: CommandMiddlewarePhase): number {
  return phase === 'admit' ? COMMAND_ADMIT_TIMEOUT_MAX_MS : COMMAND_OBSERVE_TIMEOUT_MAX_MS;
}

const isPrefix = (entry: string): boolean => entry.endsWith('.');

/**
 * Whether `filter` selects `action` (contract §4): `'*'`, the action itself,
 * or a prefix ending in `.` that the action starts with. A bare segment such as
 * `organization` is a full action, so it matches only an action spelled
 * exactly that and never `organization.register`.
 */
export function commandActionFilterMatches(filter: CommandActionFilter, action: string): boolean {
  if (filter === '*') return true;
  for (const entry of filter) {
    if (isPrefix(entry) ? action.startsWith(entry) : action === entry) return true;
  }
  return false;
}

/** Whether `entry` already selects everything `other` selects. */
function covers(entry: string, other: string): boolean {
  return isPrefix(entry) && other !== entry && other.startsWith(entry);
}

/**
 * Whether two filters can select a common action (research R-9): either is
 * `'*'`, they share an entry, or one entry is a prefix another entry starts
 * with. Two `admit` middlewares from modules no dependency orders refuse
 * composition only when this holds, so strangers with disjoint filters never
 * have to know each other.
 */
export function commandActionFiltersOverlap(left: CommandActionFilter, right: CommandActionFilter): boolean {
  if (left === '*' || right === '*') return true;
  for (const a of left) {
    for (const b of right) {
      if (a === b || covers(a, b) || covers(b, a)) return true;
    }
  }
  return false;
}

/**
 * The cross-entry rules of a manifest's `commandMiddleware` (contract §1),
 * each refusal naming the module: one id declared twice, a `timeoutMs` above
 * its phase's maximum, and a filter list with a duplicate or with an entry a
 * shorter prefix in the same list already covers. Called by
 * `defineModuleManifest`.
 */
export function assertCommandMiddlewareRules(m: {
  readonly id: string;
  readonly commandMiddleware?: readonly CommandMiddlewareDeclaration[] | undefined;
}): void {
  const seen = new Set<string>();
  for (const declaration of m.commandMiddleware ?? []) {
    if (seen.has(declaration.id)) {
      throw new Error(
        `[contracts/command-middleware] manifest "${m.id}" declares command middleware '${declaration.id}' ` +
          'twice. A middleware id is unique within its module.',
      );
    }
    seen.add(declaration.id);
    const max = commandMiddlewareTimeoutMaxMs(declaration.phase);
    if (declaration.timeoutMs !== undefined && declaration.timeoutMs > max) {
      throw new Error(
        `[contracts/command-middleware] manifest "${m.id}" gives ${declaration.phase} middleware ` +
          `'${declaration.id}' a timeoutMs of ${declaration.timeoutMs}; the ${declaration.phase} maximum is ${max} ms.`,
      );
    }
    if (declaration.actions === '*') continue;
    const entries = declaration.actions;
    entries.forEach((entry, index) => {
      if (entries.indexOf(entry) !== index) {
        throw new Error(
          `[contracts/command-middleware] manifest "${m.id}": command middleware '${declaration.id}' ` +
            `lists '${entry}' twice in its actions.`,
        );
      }
      const coveredBy = entries.find((other) => covers(other, entry));
      if (coveredBy !== undefined) {
        throw new Error(
          `[contracts/command-middleware] manifest "${m.id}": command middleware '${declaration.id}' ` +
            `lists '${entry}', which the prefix '${coveredBy}' in the same list already covers. ` +
            'Drop the narrower entry.',
        );
      }
    });
  }
}
