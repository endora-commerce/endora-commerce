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
  onConflict?: (conflict: TaxIdConflict) => Error,
): Promise<T> {
  try {
    return await bus.run(command);
  } catch (err) {
    throw organizationWriteError(err, onConflict);
  }
}

/**
 * What a write of `organizations` answers for a database refusal: the path's
 * own 409 for a tax-ID conflict, {@link writeContendedRefusal} for a lock it
 * lost (review finding 2), and the error itself for anything else.
 */
export function organizationWriteError(err: unknown, onConflict?: (conflict: TaxIdConflict) => Error): unknown {
  if (err instanceof HttpError) return err;
  if (isWriteContention(err)) return writeContendedRefusal();
  const conflict = taxIdConflictOf(err);
  if (conflict !== null && onConflict) return onConflict(conflict);
  return err;
}

/**
 * PostgreSQL's answers to a lock a transaction lost — `40P01` (deadlock
 * detected, the victim chosen) and `55P03` (lock not available within
 * `lock_timeout`) — on the error or what it wraps. The tax-ID scope swap and a
 * writer of `organizations` can meet either; neither is the request's fault,
 * and a retry succeeds.
 */
export function isWriteContention(err: unknown): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate === null || typeof candidate !== 'object' || seen.has(candidate)) continue;
    seen.add(candidate);
    const { code, cause, previous } = candidate as { code?: unknown; cause?: unknown; previous?: unknown };
    if (code === '40P01' || code === '55P03') return true;
    queue.push(cause, previous);
  }
  return false;
}

/** A write that lost a lock to a concurrent one; retrying it succeeds. */
export function writeContendedRefusal(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ORGANIZATION_WRITE_CONTENDED,
    'Another change to organizations was in progress. Try again in a moment.',
  );
}

/** The creation refusal (registration, admin create, conversion) — whichever constraint answered. */
export function taxIdExistsRefusal(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
    'An organization with this taxId already exists.',
  );
}
