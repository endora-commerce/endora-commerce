import { aggregateCommandSourceSchema, ERROR_CODES, type AggregateCommandOptions } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * What `customerAccountCommandPort` (`specs/186-aggregate-ports/` US3, issue
 * #1822, D-293.6) adds to a Command: the caller's `source` code, recorded as
 * `source` in the entry's `stateAfter` beside the actor, and the extension
 * input for the action's command hooks.
 *
 * One wrapper for every method rather than a `source` parameter on each
 * factory: an admin route calls the port with no options and runs the factory
 * as it is, and a server-side caller's options are added through this, so the
 * two cannot record different states apart from the one key only a
 * server-side caller sets. A Command that answers `skipAudit`
 * records nothing, `source` included.
 *
 * The bus refuses an extension key no present hook module claims before the
 * Command's `capture` and `run`, so nothing is written; the port validates
 * `source` with {@link assertCallerSource} before it reads anything.
 *
 * The same twenty lines as `organizations`' `commands/caller-options.ts`, not
 * an import of them: a module's `commands/` directory is its own, and the two
 * owners are the only callers (research R-17.6).
 */
export interface CallerOptions {
  readonly source?: string | undefined;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}

export function withCallerOptions<T>(command: Command<T>, options: CallerOptions): Command<T> {
  const { source, extensions } = options;
  if (source === undefined && extensions === undefined) return command;
  return {
    ...command,
    ...(extensions !== undefined ? { extensions } : {}),
    run: async (ctx) => {
      const outcome = await command.run(ctx);
      if (source === undefined || outcome.skipAudit) return outcome;
      return { ...outcome, after: { ...(outcome.after ?? {}), source } };
    },
  };
}

/**
 * Refuses a `source` outside {@link aggregateCommandSourceSchema} with
 * `422 VALIDATION_FAILED`, as every aggregate port does, before the method reads
 * or writes anything (issue #1922: a refusal after a first write is too late).
 */
export function assertCallerSource(options: AggregateCommandOptions): void {
  if (options.source !== undefined && !aggregateCommandSourceSchema.safeParse(options.source).success) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'source must be a lower-case code of at most 64 characters.',
      [{ path: 'source', issue: 'invalid_format' }],
    );
  }
}
