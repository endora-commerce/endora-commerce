import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which hook is running on this async path (`specs/176-command-hooks-outbox/`
 * FR-021, research R-12).
 *
 * Set by the Command Bus around each hook and inherited by everything the hook
 * awaits, the Commands it runs through `ctx.run` included. An owner-side
 * accessor uses it to assert which module is writing — spec 178's `x_<module>_*`
 * columns may be written only by `<module>`'s own hook.
 */
export interface CommandHookOrigin {
  readonly moduleId: string;
  readonly hookId: string;
  readonly action: string;
}

const storage = new AsyncLocalStorage<CommandHookOrigin>();

/** The hook currently running on this async path, or `undefined` outside every hook. */
export function currentCommandHookOrigin(): CommandHookOrigin | undefined {
  return storage.getStore();
}

/** Run `fn` with `origin` as the current hook. Platform-internal: the bus calls it. */
export function runWithCommandHookOrigin<T>(origin: CommandHookOrigin, fn: () => T): T {
  return storage.run(Object.freeze({ ...origin }), fn);
}
