import { attachPlatformLogger, type PlatformLogger } from '../../kernel/logging.js';

/**
 * Point the platform's own log lines at a `module:*` command's error channel
 * for as long as the command runs, and return the detach (issue #819).
 *
 * ## Why a command needs one
 *
 * `platformLogger()` writes to the destination `buildServer` attaches, and to
 * `console.info` — stdout — before one exists, which is right for a server's
 * boot line. An operator command builds no server, so every platform line it
 * provoked landed on stdout: the tenancy-chain notice the ORM bootstrap emits
 * (`assertTransitiveParentsResolve`) arrived in front of `module:status
 * --json`'s document and made it unparseable. A command's stdout is its answer;
 * what the platform has to say about itself on the way belongs beside the
 * command's own diagnostics, on `err`.
 *
 * Each line is one JSON object — `level` and `msg` first, then the caller's
 * fields — the shape the escape-hatch audit writer's stderr lines already
 * have, so an operator reading stderr sees one format. `level` and `msg` are
 * the line's own and are written after the fields, so a field cannot shadow
 * them.
 */
export function attachOperatorDiagnostics(err: (line: string) => void): () => void {
  const emit =
    (level: keyof PlatformLogger) =>
    (obj: object, msg: string): void => {
      err(`${JSON.stringify(Object.assign({ level, msg }, obj, { level, msg }))}\n`);
    };
  return attachPlatformLogger({ info: emit('info'), warn: emit('warn'), error: emit('error') });
}
