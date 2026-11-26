import { ERROR_CODES, type ErrorCode, type ModuleErrorCode } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';

/**
 * Command-middleware errors (`specs/189-command-middleware/` FR-002, FR-004,
 * FR-012 – FR-015, FR-031; `contracts/command-middleware-api.md` §3, §5, §7).
 *
 * Two families, as for command hooks. The **composition** refusals are thrown
 * while the registry is sealed — after the last module registered, before any
 * boot hook — and each names the module, the middleware id and the remedy.
 * The **run-time** answers are `HttpError`s the Command Bus throws before the
 * refused Command writes anything.
 */

/** `<module>#<id>`, the spelling every message, log line and outcome uses. */
export function middlewareLabel(moduleId: string, id: string): string {
  return `${moduleId}#${id}`;
}

/** A registration with no manifest declaration of that id. */
export class UndeclaredCommandMiddlewareError extends Error {
  constructor(
    readonly moduleId: string,
    readonly middlewareId: string,
  ) {
    super(
      `[command-middleware] module '${moduleId}' registers command middleware '${middlewareId}', which its ` +
        "manifest does not declare. Add { id: '" +
        middlewareId +
        "', phase, actions } to the manifest's `commandMiddleware`: the declaration is what the divergence " +
        'report, `endora generate` and the action filter read.',
    );
    this.name = 'UndeclaredCommandMiddlewareError';
  }
}

/** A manifest declaration with no registration. */
export class UnregisteredCommandMiddlewareError extends Error {
  constructor(
    readonly moduleId: string,
    readonly middlewareId: string,
  ) {
    super(
      `[command-middleware] module '${moduleId}' declares command middleware '${middlewareId}' in its manifest ` +
        'but never registers it. Register the code from registerModule with ' +
        `ctx.commandMiddleware([{ id: '${middlewareId}', phase, … }]), or remove the declaration.`,
    );
    this.name = 'UnregisteredCommandMiddlewareError';
  }
}

/** Declaration and registration of one id name different phases. */
export class CommandMiddlewarePhaseMismatchError extends Error {
  constructor(
    readonly moduleId: string,
    readonly middlewareId: string,
    readonly declared: string,
    readonly registered: string,
  ) {
    super(
      `[command-middleware] module '${moduleId}' declares command middleware '${middlewareId}' as '${declared}' ` +
        `but registers it as '${registered}'. Make the manifest and ctx.commandMiddleware agree.`,
    );
    this.name = 'CommandMiddlewarePhaseMismatchError';
  }
}

/** One module registering one id twice. */
export class DuplicateCommandMiddlewareError extends Error {
  constructor(
    readonly moduleId: string,
    readonly middlewareId: string,
  ) {
    super(
      `[command-middleware] module '${moduleId}' registers command middleware '${middlewareId}' twice. ` +
        'A middleware id is unique within its module.',
    );
    this.name = 'DuplicateCommandMiddlewareError';
  }
}

/** An `admit` from a module of origin `package` (D-296.3). */
export class CommandMiddlewareOriginError extends Error {
  constructor(
    readonly moduleId: string,
    readonly middlewareId: string,
  ) {
    super(
      `[command-middleware] module '${moduleId}' is an installed package (origin 'package') and declares ` +
        `admit middleware '${middlewareId}'. An installed package may contribute observe middleware only ` +
        '(ruling D-296.3); no grant changes that. Declare it as observe, or move the admission rule into ' +
        "the deployment's own overlay module.",
    );
    this.name = 'CommandMiddlewareOriginError';
  }
}

/** Two overlapping `admit` middlewares from modules no dependency path and no deployment order rank. */
export class UnorderedCommandMiddlewareError extends Error {
  constructor(
    readonly modules: readonly [string, string],
    readonly middleware: readonly string[],
  ) {
    const [a, b] = modules;
    super(
      `[command-middleware] modules '${a}' and '${b}' both contribute admit middleware whose action filters ` +
        `can match the same Command (${middleware.join(', ')}), and neither depends on the other, so nothing ` +
        'decides which runs first — and the first refusal wins. Either make one depend on the other in its ' +
        "manifest, or declare the order in the deployment's divergence.ts: " +
        `commandMiddlewareOrder: ['${a}', '${b}'] — first runs first.`,
    );
    this.name = 'UnorderedCommandMiddlewareError';
  }
}

/** A deployment order that contradicts a dependency path. */
export class CommandMiddlewareOrderContradictionError extends Error {
  constructor(
    readonly declared: readonly string[],
    readonly dependency: { readonly before: string; readonly after: string },
  ) {
    super(
      `[command-middleware] the deployment's commandMiddlewareOrder (${declared.join(' → ')}) runs ` +
        `'${dependency.after}' before '${dependency.before}', but '${dependency.after}' depends on ` +
        `'${dependency.before}', so '${dependency.before}' runs first. The dependency graph is the order; ` +
        'commandMiddlewareOrder only breaks ties it leaves open. Remove or reverse the entry.',
    );
    this.name = 'CommandMiddlewareOrderContradictionError';
  }
}

/** An order entry naming a module that contributes no `admit`. */
export class StaleCommandMiddlewareOrderError extends Error {
  constructor(
    readonly declared: readonly string[],
    readonly stale: readonly string[],
  ) {
    super(
      `[command-middleware] the deployment's commandMiddlewareOrder (${declared.join(' → ')}) names ` +
        `${stale.map((m) => `'${m}'`).join(', ')}, which contribute${stale.length === 1 ? 's' : ''} no admit ` +
        'middleware to this composition. Remove the entry from divergence.ts: an order for a module that is ' +
        'not there orders nothing, and will order the wrong thing later.',
    );
    this.name = 'StaleCommandMiddlewareOrderError';
  }
}

// ---- run-time answers ------------------------------------------------------

/** The statuses an admission refusal may carry (research R-5). */
export type CommandRefusalStatus = 403 | 409 | 422 | 429 | 503;

/**
 * How an `admit` middleware refuses a Command (FR-012). The code is one the
 * contributing module declares in its manifest's `errorCodes` and translates
 * in pl and en (feature 090); the bus does not check it at run time, the test
 * kit's `expectDeclaredRefusal` does in the author's own suite.
 *
 * `retryAfterSeconds` is the one detail a refusal may carry; it also sets the
 * `Retry-After` header, as a rate limit's answer should.
 */
export class CommandRefusedError extends HttpError {
  constructor(
    code: ErrorCode | ModuleErrorCode,
    options: { readonly status?: CommandRefusalStatus; readonly retryAfterSeconds?: number } = {},
  ) {
    const retry = options.retryAfterSeconds;
    if (retry !== undefined && !(Number.isInteger(retry) && retry > 0)) {
      throw new Error(`[command-middleware] CommandRefusedError retryAfterSeconds must be a positive integer; got ${retry}.`);
    }
    super(
      options.status ?? 403,
      code,
      `The Command was refused by an admission rule (${code}).`,
      retry === undefined ? undefined : { retryAfterSeconds: retry },
      retry === undefined ? undefined : { 'Retry-After': String(retry) },
    );
    this.name = 'CommandRefusedError';
  }
}

export function admissionTimeout(label: string, action: string): HttpError {
  return new HttpError(
    503,
    ERROR_CODES.COMMAND_ADMISSION_TIMEOUT,
    `The admission rule '${label}' did not answer in time for '${action}'; nothing was written.`,
  );
}

export function admissionFailed(label: string, action: string): HttpError {
  return new HttpError(
    503,
    ERROR_CODES.COMMAND_ADMISSION_FAILED,
    `The admission rule '${label}' failed for '${action}'; nothing was written.`,
  );
}

export function middlewareReentry(label: string, action: string): HttpError {
  return new HttpError(
    500,
    ERROR_CODES.COMMAND_MIDDLEWARE_REENTRY,
    `Command middleware '${label}' tried to run the Command '${action}'. Middleware never writes.`,
  );
}
