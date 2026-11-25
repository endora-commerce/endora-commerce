import {
  ERROR_CODES,
  mergeIdOfScopeReason,
  type RecordMergeHostType,
} from '@endora-commerce/contracts';
import { HttpError } from '../http/error-envelope.js';
import { getTenantContext, type TenantContext } from './tenant-context.js';

/**
 * The merge freeze, as the tenant seams read it (`specs/192-organization-merge/`
 * research R-6, R-8, `contracts/merge-mechanism.md` §4).
 *
 * Two in-process sets per host type, both held here and written only by the
 * platform's merge mechanism (`kernel/merge/`), which loads them at boot,
 * refreshes them on the `b2b:record-merge:changed` channel and reloads them
 * every five minutes:
 *
 *  - **frozen** — the loser of a `running` or `needs_attention` merge, with the
 *    merge's id. A write naming it is refused `409 RECORD_MERGE_IN_PROGRESS`,
 *    except inside that merge's own system scope (`record-merge:<mergeId>`),
 *    which is where its steps run;
 *  - **archived** — the loser of a completed merge, with its survivor. A write
 *    naming it is refused with the host's merged code carrying `survivorId`
 *    (OQ-6: refused, never redirected).
 *
 * The checks add no query to a request: they are a map lookup. A lost pub/sub
 * message makes the sets stale for at most the reload interval, never empty by
 * error — the reload replaces them whole.
 */

interface FrozenEntry {
  readonly mergeId: string;
}

interface ArchivedEntry {
  readonly mergeId: string;
  readonly survivorId: string;
}

export interface MergeFreezeSnapshot {
  readonly frozen: ReadonlyArray<{ readonly hostType: RecordMergeHostType; readonly id: string; readonly mergeId: string }>;
  readonly archived: ReadonlyArray<{
    readonly hostType: RecordMergeHostType;
    readonly id: string;
    readonly mergeId: string;
    readonly survivorId: string;
  }>;
}

/** The refusal a write naming a merging or merged record gets. */
export type MergeFreezeRefusal =
  | { readonly kind: 'frozen'; readonly mergeId: string }
  | { readonly kind: 'archived'; readonly mergeId: string; readonly survivorId: string };

class MergeFreezeState {
  #frozen = new Map<string, FrozenEntry>();
  #archived = new Map<string, ArchivedEntry>();

  #key(hostType: RecordMergeHostType, id: string): string {
    return `${hostType}/${id}`;
  }

  /** Replace both sets whole (boot load, pub/sub refresh, periodic reload). */
  replace(snapshot: MergeFreezeSnapshot): void {
    const frozen = new Map<string, FrozenEntry>();
    for (const row of snapshot.frozen) frozen.set(this.#key(row.hostType, row.id), { mergeId: row.mergeId });
    const archived = new Map<string, ArchivedEntry>();
    for (const row of snapshot.archived) {
      archived.set(this.#key(row.hostType, row.id), { mergeId: row.mergeId, survivorId: row.survivorId });
    }
    this.#frozen = frozen;
    this.#archived = archived;
  }

  /** Freeze one loser now, in this process, before the announcement reaches the others. */
  freeze(hostType: RecordMergeHostType, id: string, mergeId: string): void {
    this.#frozen.set(this.#key(hostType, id), { mergeId });
  }

  /** Lift a freeze (a cancelled merge). */
  unfreeze(hostType: RecordMergeHostType, id: string): void {
    this.#frozen.delete(this.#key(hostType, id));
  }

  /** Move a loser from frozen to archived (a completed merge). */
  archive(hostType: RecordMergeHostType, id: string, mergeId: string, survivorId: string): void {
    this.#frozen.delete(this.#key(hostType, id));
    this.#archived.set(this.#key(hostType, id), { mergeId, survivorId });
  }

  refusalFor(hostType: RecordMergeHostType, id: string): MergeFreezeRefusal | null {
    const archived = this.#archived.get(this.#key(hostType, id));
    if (archived) return { kind: 'archived', mergeId: archived.mergeId, survivorId: archived.survivorId };
    const frozen = this.#frozen.get(this.#key(hostType, id));
    if (frozen) return { kind: 'frozen', mergeId: frozen.mergeId };
    return null;
  }

  isFrozen(hostType: RecordMergeHostType, id: string): boolean {
    return this.#frozen.has(this.#key(hostType, id));
  }

  archivedInto(hostType: RecordMergeHostType, id: string): string | null {
    return this.#archived.get(this.#key(hostType, id))?.survivorId ?? null;
  }

  /** Test seam: forget everything. */
  clear(): void {
    this.#frozen = new Map();
    this.#archived = new Map();
  }
}

/** The process's merge freeze. One per process, like the module presence cache. */
export const mergeFreezeState = new MergeFreezeState();

/**
 * The host's merged code per host type (OQ-6): `ORGANIZATION_MERGED` and, for
 * the Project host (US6, `contracts/project-merge.md`), `PROJECT_MERGED`, each
 * carrying the survivor's id.
 */
const MERGED_CODE: Readonly<
  Record<RecordMergeHostType, typeof ERROR_CODES.ORGANIZATION_MERGED | typeof ERROR_CODES.PROJECT_MERGED>
> = {
  organization: ERROR_CODES.ORGANIZATION_MERGED,
  project: ERROR_CODES.PROJECT_MERGED,
};

/**
 * Is `ctx` the merge's own scope? Only the steps of merge `mergeId` may write a
 * record that merge froze.
 */
export function isMergeScopeOf(ctx: TenantContext | undefined, mergeId: string): boolean {
  if (ctx === undefined || ctx.mode !== 'system') return false;
  return mergeIdOfScopeReason(ctx.reason) === mergeId;
}

/**
 * The HTTP error a write naming `id` gets, or `null` when the write may
 * proceed. A frozen record is writable inside its own merge's scope; an
 * archived one by nobody.
 */
export function mergeWriteRefusal(
  hostType: RecordMergeHostType,
  id: string,
  ctx: TenantContext | undefined = getTenantContext(),
): HttpError | null {
  const refusal = mergeFreezeState.refusalFor(hostType, id);
  if (refusal === null) return null;
  if (refusal.kind === 'archived') {
    return new HttpError(
      409,
      MERGED_CODE[hostType],
      `This ${hostType} was merged into another one; write to the survivor instead.`,
      { survivorId: refusal.survivorId, mergeId: refusal.mergeId },
    );
  }
  if (isMergeScopeOf(ctx, refusal.mergeId)) return null;
  return new HttpError(
    409,
    ERROR_CODES.RECORD_MERGE_IN_PROGRESS,
    `This ${hostType} is being merged; it cannot be changed until the merge completes.`,
    { mergeId: refusal.mergeId },
  );
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The tenant-resolution seam (R-6, seam 1): a customer or bound API-key
 * request pinned to a frozen or archived Organization may read, and is refused
 * on any unsafe method. An administrator's context is never pinned to one
 * Organization, so it is not refused here — the host's own routes and the org
 * write guard answer for it.
 */
export function refuseMergingTenantWrite(tenant: TenantContext, method: string): void {
  if (SAFE_METHODS.has(method.toUpperCase())) return;
  if (tenant.mode !== 'single-org' || typeof tenant.organizationId !== 'string') return;
  const kind = tenant.actor?.kind;
  if (kind !== 'customer' && kind !== 'api_key') return;
  const refusal = mergeWriteRefusal('organization', tenant.organizationId, tenant);
  if (refusal !== null) throw refusal;
}
