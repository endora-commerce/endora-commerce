import { getCurrentPlatformScope } from './scope.js';

/**
 * Where a module's log lines go (issue #269).
 *
 * ## What was wrong
 *
 * `ModuleContext.log` was whatever the composition root could name at the
 * moment it composed, and composition runs before `buildServer`. So
 * `composition.ts` passed the global `console` and the test harness passed a
 * no-op — the two roots disagreed on the destination, and neither of them was
 * the log the platform actually collects. A module writing `ctx.log.warn(...)`
 * produced an unstructured line on stdout, uncorrelated with the request that
 * caused it and outside the pino stream a deployment ships.
 *
 * Four modules feed `ctx.log` into a service that keeps it (`invoices`,
 * `payments`, `pwa`, `shipments`), and `invoices` writes `{ module: 'invoices' }`
 * into every object by hand, which is the attribution this file makes automatic.
 *
 * ## The shape
 *
 * Two concerns, deliberately split, because they have different owners:
 *
 *  - **The destination** ({@link platformLogger}) is late-bound. A composition
 *    root passes it before there is an app; `buildServer` attaches the app's
 *    own pino instance the moment one exists, so every line emitted after that
 *    lands in the collected log without either root remembering to do anything.
 *  - **Attribution and correlation** ({@link moduleLogger}) are applied per
 *    line, over whatever destination the root chose. `createModuleContext` wraps
 *    the root's logger in one of these, so `ctx.log` stamps the module id and
 *    the current request's id without the author naming either.
 *
 * ## Why the request id, and not `request.log`
 *
 * Fastify's `request.log` is `app.log.child({ reqId })` and nothing else, so a
 * line carrying `reqId` joins up with Fastify's own `req`/`res` lines exactly
 * as one written through `request.log` would. Reading the id out of the
 * platform scope instead of holding the request buys two things: it works from
 * any depth without threading `request`, and it retains nothing — `scope.ts`
 * documents at length that a value captured into the scope is pinned for as
 * long as any async resource created inside it lives, and a Fastify request is
 * the single most expensive thing that could be pinned there.
 *
 * ## Outside a request, and before the app exists
 *
 * There is no request id to stamp, so the line carries the module id alone and
 * is emitted all the same. Which destination it reaches depends on where the
 * process is:
 *
 *  - **A boot hook** runs before `buildServer` in both composition roots, so it
 *    reaches {@link consoleFallback}. That is what a boot line has always had,
 *    and it is on stdout, where a boot failure is read.
 *  - **A worker, a timer, an EventBus subscriber** all run after the app was
 *    built — `worker.ts` builds a server it never listens on, precisely so the
 *    module plugins register — so they reach the app's pino instance.
 *  - **A process that composes modules and builds no server** (the boot-shape
 *    integration tests) reaches the fallback.
 *
 * The fallback is a real write, never a no-op: turning an unstructured line
 * into a dropped one would be a worse platform than the one this replaces.
 */
export interface PlatformLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

type LogLevel = 'info' | 'warn' | 'error';

/**
 * The destination before one is attached, and after the app that was attached
 * has closed.
 *
 * `console.info` is the one call the repository's `no-console` rule does not
 * already allow; it is right here, because this object exists to be the last
 * resort of a platform whose structured logger does not exist yet, and
 * downgrading an info line to `console.warn` would misreport its level to
 * whatever is reading stdout.
 */
const consoleFallback: PlatformLogger = {
  // eslint-disable-next-line no-console -- the pre-`buildServer` destination; see above.
  info: (obj, msg) => console.info(obj, msg),
  warn: (obj, msg) => console.warn(obj, msg),
  error: (obj, msg) => console.error(obj, msg),
};

let destination: PlatformLogger | undefined;

/**
 * Point every {@link platformLogger} at `logger`, and return a detach.
 *
 * Called once per built server, from `buildServer` — the one place in the tree
 * where the platform's collected logger comes into existence, and therefore the
 * only place where neither composition root can forget it and the two cannot
 * drift apart on it.
 *
 * The detach clears the slot **only if this logger is still the current one**,
 * so a suite that builds a second server before closing the first does not have
 * the first one's teardown silence the second.
 */
export function attachPlatformLogger(logger: PlatformLogger): () => void {
  destination = logger;
  return (): void => {
    if (destination === logger) destination = undefined;
  };
}

/** The attached destination, or `undefined` when nothing is attached. Diagnostics and tests. */
export function currentPlatformLogger(): PlatformLogger | undefined {
  return destination;
}

/**
 * The late-bound destination a composition root passes as `log`.
 *
 * It reads the slot **per line** rather than capturing it, which is the whole
 * point: composition happens before the app exists, so anything captured at
 * composition time is the fallback forever.
 */
export function platformLogger(): PlatformLogger {
  const emit =
    (level: LogLevel) =>
    (obj: object, msg: string): void => {
      (destination ?? consoleFallback)[level](obj, msg);
    };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/**
 * Wrap `destination` so every line it carries names `moduleId`, and names the
 * request it was emitted during when there is one.
 *
 * The module id is written **after** the caller's own fields, so attribution is
 * the wrapper's answer and not something a caller can shadow by accident. The
 * request id is written the same way; a caller that genuinely means a different
 * correlation names its own field.
 */
export function moduleLogger(moduleId: string, to: PlatformLogger): PlatformLogger {
  const emit =
    (level: LogLevel) =>
    (obj: object, msg: string): void => {
      const requestId = getCurrentPlatformScope()?.requestMeta?.requestId;
      to[level]({ ...obj, module: moduleId, ...(requestId ? { reqId: requestId } : {}) }, msg);
    };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}
