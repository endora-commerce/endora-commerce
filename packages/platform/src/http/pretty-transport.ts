/**
 * The development log transport — `pino-pretty`, resolved from this package.
 *
 * Both places that pretty-print (`server.ts`, which hands Fastify its logger
 * options, and `logger.ts`) take the transport from here, so the rule lives
 * once:
 *
 *   * **the target is the resolved path**, not the bare name. Pino resolves a
 *     bare target from the files on its call stack and the working directory,
 *     which made `0.100.0` boot inside this repository — the backend declared
 *     `pino-pretty` — and die in a scaffolded instance, where nothing did.
 *     `pino-pretty` is a dependency of this package for the same reason.
 *   * **a pretty log is a nicety, never a boot precondition.** When it cannot
 *     be resolved (a pruned install, a bundler that dropped it) the answer is
 *     no transport, and pino writes plain JSON to stdout.
 *
 * Production is not affected either way: the callers ask for this only when
 * `NODE_ENV` is not `production`.
 */
import { createRequire } from 'node:module';

/** How a module name becomes a path. Injected so a test can make it fail. */
export type Resolve = (name: string) => string;

const ownResolve: Resolve = (name) => createRequire(import.meta.url).resolve(name);

/** The pino transport for a human-readable development log, or `undefined`. */
export function prettyTransport(
  resolve: Resolve = ownResolve,
): { target: string; options: Record<string, unknown> } | undefined {
  let target: string;
  try {
    target = resolve('pino-pretty');
  } catch {
    return undefined;
  }
  return {
    target,
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
  };
}
