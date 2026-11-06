import { isDeepStrictEqual } from 'node:util';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, savedListViewNameKey, type SavedListView, isUuidShape } from '@endora-commerce/contracts';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { QuoteRequestListSavedView } from '../entities/quote-request-list-saved-view.entity.js';

export interface QuoteRequestSavedViewSort {
  field: string;
  dir: 'asc' | 'desc';
}

export interface QuoteRequestSavedViewInput {
  name: string;
  shared: boolean;
  filters: Record<string, unknown>;
  sort?: QuoteRequestSavedViewSort | null | undefined;
  visibleColumns?: string[] | null | undefined;
}

export interface QuoteRequestSavedViewPatch {
  name?: string | undefined;
  shared?: boolean | undefined;
  filters?: Record<string, unknown> | undefined;
  sort?: QuoteRequestSavedViewSort | null | undefined;
  visibleColumns?: string[] | null | undefined;
}

/** Who is asking: the admin, and whether they are a platform admin (research R-7). */
export interface QuoteRequestSavedViewActor {
  adminUserId: string;
  isPlatformAdmin: boolean;
}

const TABLE = 'quote_request_list_saved_views';

/**
 * QuoteRequestListViewService — `specs/147-saved-views/` (US3).
 *
 * Per-admin saved filter, sort and column presets for the admin Quote Request
 * list, on the rules the order list's views follow (FR-013): a caller sees
 * their own views plus every shared view; another admin's private view behaves
 * as absent (404); a shared view is modified or deleted only by its owner or a
 * platform admin (403 otherwise). A view stores filter values only, never list
 * results: loading it re-runs the list read for whoever loads it, which is
 * what keeps FR-016 out of this service (research R-16).
 *
 * Names are stored trimmed, and one owner holds no two views whose names share
 * a key (FR-022). `create` and a key-changing `update` take a
 * transaction-scoped advisory lock keyed on the **view owner** and probe for
 * the key inside the same transaction (research R-5, threat model S-04); the
 * table's unique expression index on `(owner_admin_user_id, lower(name))` is
 * the schema's own guarantee, and a violation of it answers the same 409.
 *
 * Saved views are personal UI configuration, not domain mutations: they do not
 * run through the Command Bus (research R-14). When a platform admin modifies
 * or deletes another admin's view, one structured `info` record is written
 * instead (research R-18, S-11).
 */
export class QuoteRequestListViewService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly log?: Pick<PlatformLogger, 'info'>,
  ) {}

  /** The caller's own views plus every shared view, ordered by name. */
  async listFor(actor: QuoteRequestSavedViewActor): Promise<SavedListView[]> {
    const em = this.emFactory();
    const views = await em.find(
      QuoteRequestListSavedView,
      { $or: [{ ownerAdminUserId: actor.adminUserId }, { shared: true }] },
      { orderBy: { name: 'asc' } },
    );
    return views.map((v) => toDto(v, actor));
  }

  async create(actor: QuoteRequestSavedViewActor, input: QuoteRequestSavedViewInput): Promise<SavedListView> {
    const name = input.name.trim();
    const view = await refuseDuplicateKey(() =>
      this.emFactory().transactional(async (tx) => {
        await assertNameAvailable(tx, actor.adminUserId, name);
        // command-coverage-ignore: per-admin saved list preset — personal UI
        // configuration, not a domain mutation.
        const created = tx.create(QuoteRequestListSavedView, {
          ownerAdminUserId: actor.adminUserId,
          name,
          shared: input.shared,
          filters: input.filters,
          sort: input.sort ?? null,
          visibleColumns: input.visibleColumns ?? null,
        });
        // command-coverage-ignore: per-admin saved list preset — personal UI
        // configuration, not a domain mutation.
        await tx.persistAndFlush(created);
        return created;
      }),
    );
    return toDto(view, actor);
  }

  async update(id: string, actor: QuoteRequestSavedViewActor, patch: QuoteRequestSavedViewPatch): Promise<SavedListView> {
    const { view, changed } = await refuseDuplicateKey(() =>
      this.emFactory().transactional(async (tx) => {
        const found = await loadModifiable(tx, id, actor);
        // A PATCH that changes nothing is answered as a read: no write and no
        // trail line (security review SV-4). The gate above still applies.
        let changed = false;
        const name = patch.name?.trim();
        if (name !== undefined && name !== found.name) {
          // Only a change of key can create a conflict; changing a name's case
          // only cannot.
          if (savedListViewNameKey(name) !== savedListViewNameKey(found.name)) {
            // The rule binds the view's owner, never the caller (S-04).
            await assertNameAvailable(tx, found.ownerAdminUserId, name, found.id);
          }
          found.name = name;
          changed = true;
        }
        if (patch.shared !== undefined && patch.shared !== found.shared) {
          found.shared = patch.shared;
          changed = true;
        }
        if (patch.filters !== undefined && !isDeepStrictEqual(patch.filters, found.filters)) {
          found.filters = patch.filters;
          changed = true;
        }
        if (patch.sort !== undefined && !isDeepStrictEqual(patch.sort, found.sort)) {
          found.sort = patch.sort;
          changed = true;
        }
        if (patch.visibleColumns !== undefined && !isDeepStrictEqual(patch.visibleColumns, found.visibleColumns)) {
          found.visibleColumns = patch.visibleColumns;
          changed = true;
        }
        if (!changed) return { view: found, changed };
        // command-coverage-ignore: per-admin saved list preset — personal UI
        // configuration, not a domain mutation.
        await tx.flush();
        return { view: found, changed };
      }),
    );
    if (changed) this.logForeignWrite('saved_view.updated', view, actor);
    return toDto(view, actor);
  }

  async remove(id: string, actor: QuoteRequestSavedViewActor): Promise<void> {
    const view = await this.emFactory().transactional(async (tx) => {
      const found = await loadModifiable(tx, id, actor);
      // command-coverage-ignore: per-admin saved list preset — personal UI
      // configuration, not a domain mutation.
      await tx.removeAndFlush(found);
      return found;
    });
    this.logForeignWrite('saved_view.deleted', view, actor);
  }

  /** One trail line when the actor is not the owner (S-11); none otherwise. */
  private logForeignWrite(
    event: 'saved_view.updated' | 'saved_view.deleted',
    view: { id: string; ownerAdminUserId: string },
    actor: QuoteRequestSavedViewActor,
  ): void {
    if (view.ownerAdminUserId === actor.adminUserId) return;
    this.log?.info(
      {
        event,
        list: TABLE,
        viewId: view.id,
        ownerAdminUserId: view.ownerAdminUserId,
        actorAdminUserId: actor.adminUserId,
      },
      'Saved quote request list view changed by an admin who does not own it.',
    );
  }
}

function nameTaken(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.RFQ_SAVED_VIEW_NAME_TAKEN,
    'You already have a saved view with this name on the quote request list. Choose a different name.',
  );
}

/**
 * The unique key index is the last word on a duplicate: should a write reach
 * it past the probe, it answers the same 409 the probe does.
 */
async function refuseDuplicateKey<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof UniqueConstraintViolationException) throw nameTaken();
    throw err;
  }
}

/**
 * Serialise this owner's saves on the quote request list and refuse a name whose key
 * the owner already uses. Must run inside the caller's transaction: the lock
 * is released when it ends, and both statements go through it.
 */
async function assertNameAvailable(
  tx: EntityManager,
  ownerAdminUserId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`${TABLE}:${ownerAdminUserId}`]);
  const params: unknown[] = [ownerAdminUserId, name];
  let sql = `select 1 from ${TABLE} where owner_admin_user_id = ? and lower(btrim(name)) = lower(btrim(?))`;
  if (excludeId) {
    sql += ' and id <> ?';
    params.push(excludeId);
  }
  const rows = (await tx.execute(`${sql} limit 1`, params)) as unknown[];
  if (rows.length > 0) throw nameTaken();
}

/**
 * A view id without the shape of a `uuid` column value names no view, so it
 * answers the same 404 as an absent one instead of reaching PostgreSQL, whose
 * `invalid input syntax for type uuid` would surface as a 500 (`isUuidShape`).
 */
async function loadModifiable(
  tx: EntityManager,
  id: string,
  actor: QuoteRequestSavedViewActor,
): Promise<QuoteRequestListSavedView> {
  if (!isUuidShape(id)) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Saved view not found.');
  }
  const view = await tx.findOne(QuoteRequestListSavedView, { id });
  if (!view) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Saved view not found.');
  const owns = view.ownerAdminUserId === actor.adminUserId;
  if (!view.shared && !owns) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Saved view not found.');
  }
  // A shared view may only be modified or deleted by its owner or a platform admin.
  if (view.shared && !owns && !actor.isPlatformAdmin) {
    throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only the owner can modify this shared view.');
  }
  return view;
}

function toDto(v: QuoteRequestListSavedView, actor: QuoteRequestSavedViewActor): SavedListView {
  const ownedByCaller = v.ownerAdminUserId === actor.adminUserId;
  return {
    id: v.id,
    name: v.name,
    shared: v.shared,
    ownerAdminUserId: v.ownerAdminUserId,
    ownedByCaller,
    canModify: ownedByCaller || (v.shared && actor.isPlatformAdmin),
    filters: v.filters,
    // A stored SQL `null` can hydrate as `undefined`; the response says `null`
    // so a client reads "use the default" either way.
    sort: v.sort ?? null,
    visibleColumns: v.visibleColumns ?? null,
  };
}
