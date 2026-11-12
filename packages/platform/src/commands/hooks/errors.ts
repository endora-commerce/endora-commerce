import { COMMAND_HOOK_MAX_DEPTH, ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';

/**
 * Command-hook errors (`specs/176-command-hooks-outbox/` FR-012, FR-016,
 * FR-019, FR-022, FR-023; `contracts/command-hooks-api.md` §2).
 *
 * Two families. The **composition** refusals below are thrown while the
 * registry is sealed — after the last module registered, before any boot hook
 * — so a deployment that cannot be ordered or that hooks something nobody
 * offers never serves a request. Every one names the modules, the hook id and
 * the action, because that is all an operator reading a refused boot has.
 *
 * The **run-time** refusals are `HttpError`s the Command Bus throws inside the
 * Command's transaction, so the write rolls back with them.
 */

/** `<module>#<id>`, the spelling every message and the execution plan use. */
export function hookLabel(moduleId: string, hookId: string): string {
  return `${moduleId}#${hookId}`;
}

/** A hook on an action no composed module declares hookable. */
export class UndeclaredHookableActionError extends Error {
  constructor(
    readonly moduleId: string,
    readonly hookId: string,
    readonly action: string,
  ) {
    super(
      `[command-hooks] module '${moduleId}' registers hook '${hookId}' on '${action}', which no ` +
        'composed module declares hookable. A hook attaches only to an action its owner lists in ' +
        "its manifest's `hookableActions` and publishes as a ref in @endora-commerce/contracts — " +
        'check the ref, and that the module owning the action is composed.',
    );
    this.name = 'UndeclaredHookableActionError';
  }
}

/** A hook for a phase the owner's declaration does not offer. */
export class HookPhaseNotOfferedError extends Error {
  constructor(
    readonly moduleId: string,
    readonly hookId: string,
    readonly action: string,
    readonly phase: string,
    readonly owner: string,
    readonly offered: readonly string[],
  ) {
    super(
      `[command-hooks] module '${moduleId}' registers hook '${hookId}' on '${action}' for ` +
        `'${phase}', but its owner '${owner}' offers only ${offered.map((p) => `'${p}'`).join(', ')}. ` +
        'The phases are part of the owner’s published contract; ask the owner to offer the phase.',
    );
    this.name = 'HookPhaseNotOfferedError';
  }
}

/** One action declared hookable by two modules. */
export class DuplicateHookableActionError extends Error {
  constructor(
    readonly action: string,
    readonly owners: readonly string[],
    readonly hooks: readonly string[],
  ) {
    super(
      `[command-hooks] '${action}' is declared hookable by ${owners.map((o) => `'${o}'`).join(' and ')}. ` +
        'An action has one owner — the module whose Command writes it.' +
        (hooks.length > 0 ? ` Hooks registered on it: ${hooks.join(', ')}.` : ''),
    );
    this.name = 'DuplicateHookableActionError';
  }
}

/** One module registering two hooks with one id. */
export class DuplicateCommandHookError extends Error {
  constructor(
    readonly moduleId: string,
    readonly hookId: string,
    readonly action: string,
  ) {
    super(
      `[command-hooks] module '${moduleId}' registers hook '${hookId}' twice (the second on ` +
        `'${action}'). A hook id is unique within its module.`,
    );
    this.name = 'DuplicateCommandHookError';
  }
}

/** A hook module whose manifest dependencies do not reach the action's owner. */
export class HookOwnerNotDependedOnError extends Error {
  constructor(
    readonly moduleId: string,
    readonly hookId: string,
    readonly action: string,
    readonly owner: string,
  ) {
    super(
      `[command-hooks] module '${moduleId}' registers hook '${hookId}' on '${action}', owned by ` +
        `'${owner}', but '${owner}' is not among '${moduleId}'s dependencies. Add '${owner}' to its ` +
        'manifest `dependencies`: a hook runs inside the owner’s write, so the owner must be installed ' +
        'and ordered before it.',
    );
    this.name = 'HookOwnerNotDependedOnError';
  }
}

/** Two hook modules on one action and phase that no dependency path and no deployment order rank. */
export class UnorderedCommandHooksError extends Error {
  constructor(
    readonly action: string,
    readonly phase: string,
    readonly modules: readonly [string, string],
    readonly hooks: readonly string[],
  ) {
    const [a, b] = modules;
    super(
      `[command-hooks] modules '${a}' and '${b}' both hook '${action}' (${phase}: ${hooks.join(', ')}), ` +
        'and neither depends on the other, so nothing decides which runs first. Either make one ' +
        "depend on the other in its manifest, or declare the order in the deployment's " +
        `divergence.ts: commandHookOrder: { '${action}': ['${a}', '${b}'] } — first runs first.`,
    );
    this.name = 'UnorderedCommandHooksError';
  }
}

/** A deployment order that contradicts a dependency path. */
export class CommandHookOrderContradictionError extends Error {
  constructor(
    readonly action: string,
    readonly declared: readonly string[],
    readonly dependency: { readonly before: string; readonly after: string },
  ) {
    super(
      `[command-hooks] the deployment's commandHookOrder for '${action}' (${declared.join(' → ')}) ` +
        `runs '${dependency.after}' before '${dependency.before}', but '${dependency.after}' depends ` +
        `on '${dependency.before}', so '${dependency.before}' runs first. The dependency graph is the ` +
        'order; commandHookOrder only breaks ties it leaves open. Remove or reverse the entry.',
    );
    this.name = 'CommandHookOrderContradictionError';
  }
}

/**
 * The optional readability subclass for a veto (R-9). Any `HttpError` vetoes;
 * this one only says so at the throw. The code must be one the hook's module
 * declares in `errorCodes` and translates.
 */
export class CommandHookRefusal extends HttpError {}

// ---- run-time refusals ----------------------------------------------------

export function extensionUnclaimed(action: string, keys: readonly string[]): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
    `No present hook module on '${action}' claims the extension input ${keys.map((k) => `'${k}'`).join(', ')}.`,
    keys.map((key) => ({
      path: `extensions.${key}`,
      issue: `no present module hooks '${action}' under this key`,
    })),
  );
}

export function hookCycle(action: string, chain: readonly string[]): HttpError {
  return new HttpError(
    500,
    ERROR_CODES.COMMAND_HOOK_CYCLE,
    chain.includes(action)
      ? `Command hook cycle: '${action}' reappears in its own hook chain (${[...chain, action].join(' → ')}).`
      : `Command hook nesting deeper than ${COMMAND_HOOK_MAX_DEPTH} (${[...chain, action].join(' → ')}).`,
  );
}

export function hookDataMissing(action: string): HttpError {
  return new HttpError(
    500,
    ERROR_CODES.COMMAND_HOOK_DATA_MISSING,
    `The Command '${action}' is declared hookable and supplies no hookData.`,
  );
}
