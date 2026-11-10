import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { taxIdConflictOf, type TaxIdConflict } from './tax-id-conflict.js';

/**
 * `specs/177-tax-id-scope/` (research R-6; `contracts/tax-id-scope.md` §5) — the
 * one call shape for a Command that writes `organizations.tax_id` or `path`.
 *
 * The `per-tree-root` constraint is deferred, so its violation is raised at
 * `COMMIT` — which the bus performs after the Command's `run` has returned, out
 * of reach of any catch inside it. This wraps `commandBus.run` and turns a
 * tax-ID refusal raised there (or anywhere below) into the caller's own 409;
 * every other error passes through untouched, an `HttpError` first of all.
 * `tax-id-write-paths.test.ts` holds every such Command to this wrapper.
 */
export async function runOrganizationWrite<T>(
  bus: Pick<CommandBus, 'run'>,
  command: Command<T>,
  onConflict: (conflict: TaxIdConflict) => Error,
): Promise<T> {
  try {
    return await bus.run(command);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const conflict = taxIdConflictOf(err);
    if (conflict !== null) throw onConflict(conflict);
    throw err;
  }
}

/** The creation refusal (registration, admin create, conversion) — whichever constraint answered. */
export function taxIdExistsRefusal(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
    'An organization with this taxId already exists.',
  );
}
