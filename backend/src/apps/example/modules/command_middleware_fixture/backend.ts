import { CommandRefusedError, type CommandRunOutcome } from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import {
  COMMAND_MIDDLEWARE_FIXTURE_HOLD,
  COMMAND_MIDDLEWARE_FIXTURE_MARKER,
  commandMiddlewareFixtureErrorCodes,
} from './manifest.js';

/**
 * The command-middleware fixture's composition (`specs/189-command-middleware/`
 * T023, T030).
 *
 * `hold-marked` is an `admit` on every `organization.` Command — a child run
 * inside a bigger write included — that refuses with the module's own code
 * when the request id carries the hold marker. It reads metadata only, which
 * is all an `admit` ever gets.
 *
 * `record-marked` is an `observe` that keeps, for a marked request, what the
 * run's outcome said and which tenant context the observer ran in, so a test
 * can assert both after the caller has its answer. It records into a
 * process-wide slot rather than a module variable because the test and the
 * composed platform may load this file as two module instances.
 */

/** What `record-marked` keeps per observed run. */
export interface CommandMiddlewareFixtureRecord {
  readonly outcome: CommandRunOutcome;
  readonly tenant: { readonly mode: string; readonly organizationId: string | null } | null;
}

const SLOT = Symbol.for('endora.command_middleware_fixture.observed');

/** The runs `record-marked` observed in this process, oldest first. */
export function commandMiddlewareFixtureObserved(): CommandMiddlewareFixtureRecord[] {
  const store = globalThis as unknown as Record<symbol, CommandMiddlewareFixtureRecord[] | undefined>;
  return (store[SLOT] ??= []);
}

export function registerModule(ctx: ModuleContext): void {
  ctx.commandMiddleware([
    {
      id: 'hold-marked',
      phase: 'admit',
      admit: (meta) => {
        if (meta.requestMeta.requestId?.startsWith(COMMAND_MIDDLEWARE_FIXTURE_HOLD) === true) {
          throw new CommandRefusedError(commandMiddlewareFixtureErrorCodes.COMMAND_MIDDLEWARE_FIXTURE_REFUSED, {
            status: 403,
          });
        }
      },
    },
    {
      id: 'record-marked',
      phase: 'observe',
      observe: (outcome) => {
        if (outcome.root.requestMeta.requestId?.startsWith(COMMAND_MIDDLEWARE_FIXTURE_MARKER) !== true) return;
        const tenant = getTenantContext();
        commandMiddlewareFixtureObserved().push({
          outcome,
          tenant: tenant === undefined ? null : { mode: tenant.mode, organizationId: tenant.organizationId ?? null },
        });
      },
    },
  ]);
}
