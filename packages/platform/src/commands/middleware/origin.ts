import { AsyncLocalStorage } from 'node:async_hooks';
import type { CommandMiddlewareOrigin } from './types.js';

/**
 * Which command middleware is running on this async path
 * (`specs/189-command-middleware/` FR-015, research R-13), following
 * `commands/hooks/origin.ts`.
 *
 * Set by the Command Bus around every `admit` and `observe` call and inherited
 * by everything the handler awaits. `CommandBus.run` refuses with
 * `COMMAND_MIDDLEWARE_REENTRY` when it finds one: an `admit` that runs a
 * matching Command would be admitted again without end, and an "observer" that
 * runs one is a writer outside its contract.
 */

const storage = new AsyncLocalStorage<CommandMiddlewareOrigin>();

/** The middleware currently running on this async path, or `undefined`. */
export function currentCommandMiddlewareOrigin(): CommandMiddlewareOrigin | undefined {
  return storage.getStore();
}

/** Run `fn` with `origin` as the current middleware. Platform-internal: the registry calls it. */
export function runWithCommandMiddlewareOrigin<T>(origin: CommandMiddlewareOrigin, fn: () => T): T {
  return storage.run(origin, fn);
}
