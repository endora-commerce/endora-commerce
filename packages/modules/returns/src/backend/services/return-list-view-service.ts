import { isDeepStrictEqual } from 'node:util';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, savedListViewNameKey, type SavedListView } from '@endora-commerce/contracts';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnListSavedView } from '../entities/return-list-saved-view.entity.js';

export interface ReturnSavedViewSort {
  field: string;
  dir: 'asc' | 'desc';
}

export interface ReturnSavedViewInput {
  name: string;
  shared: boolean;
  filters: Record<string, unknown>;
  sort: ReturnSavedViewSort;
  visibleColumns?: string[] | null | undefined;
}

export interface ReturnSavedViewPatch {
  name?: string | undefined;
  shared?: boolean | undefined;
  filters?: Record<string, unknown> | undefined;
  sort?: ReturnSavedViewSort | undefined;
  visibleColumns?: string[] | null | undefined;
}

/** Who is asking: the admin, and whether they are a platform admin (research R-7). */
export interface ReturnSavedViewActor {
  adminUserId: string;
  isPlatformAdmin: boolean;
}

const TABLE = 'return_list_saved_views';

/**
 * ReturnListViewService — feature 046 (US8), on the rules of
 * `specs/147-saved-views/` since #312.
 *
 * Per-admin saved filter/sort/column presets for the admin Returns list. A
 * caller sees their own views plus every shared view; another admin's private
 * view behaves as absent (404), as does an id that is not a UUID; a shared view
 * is modified or deleted only by its owner or a platform admin (403 otherwise).
 *
 * Names are stored trimmed, and one owner holds no two views whose names share
 * a key — `lower(btrim(name))` (FR-022). The table predates the rule and may
 * already hold such duplicates, or names the write rule now refuses, so — as on
 * the order list — there is no unique index and nothing is rewritten: `create`
 * and a key-changing `update` take a transaction-scoped advisory lock keyed on
 * the **view owner** and probe for the key inside the same transaction
 * (research R-5, threat model S-04). A write that only changes `shared`,
 * filters, sort or columns never probes, so a legacy row is left as it is.
 *
 * Saved views are personal UI configuration, not domain mutations: they do not
 * run through the Command Bus (research R-14). When a platform admin modifies
 * or deletes another admin's view, one structured `info` record is written
 * instead (research R-18, S-11).
 */
export class ReturnListViewService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly log?: Pick<PlatformLogger, 'info'>,
  ) {}

  /** The caller's own views plus every shared view, ordered by name. */
  async listFor(actor: ReturnSavedViewActor): Promise<SavedListView[]> {
    const em = this.emFactory();
    const views = await em.find(
      ReturnListSavedView,
      { $or: [{ ownerAdminUserId: actor.adminUserId }, { shared: true }] },
      { orderBy: { name: 'asc' } },
    );
    return views.map((v) => toDto(v, actor));
  }

  async create(actor: ReturnSavedViewActor, input: ReturnSavedViewInput): Promise<SavedListView> {
    const name = input.name.trim();
    const view = await this.emFactory().transactional(async (tx) => {
      await assertNameAvailable(tx, actor.adminUserId, name);
      // command-coverage-ignore: per-admin saved list preset — personal UI
      // configuration, not a domain mutation.
      const created = tx.create(ReturnListSavedView, {
        ownerAdminUserId: actor.adminUserId,
        name,
        shared: input.shared,
        filters: input.filters,
        sort: input.sort,
        visibleColumns: input.visibleColumns ?? null,
      });
      // command-coverage-ignore: per-admin saved list preset — personal UI
      // configuration, not a domain mutation.
      await tx.persistAndFlush(created);
      return created;
    });
    return toDto(view, actor);
  }

  async update(id: string, actor: ReturnSavedViewActor, patch: ReturnSavedViewPatch): Promise<SavedListView> {
    const { view, changed } = await this.emFactory().transactional(async (tx) => {
      const found = await loadModifiable(tx, id, actor);
      // A PATCH that changes nothing is answered as a read: no write and no
      // trail line (security review SV-4). The gate above still applies.
      let changed = false;
      const name = patch.name?.trim();
      if (name !== undefined && name !== found.name) {
        // Only a change of key can create a conflict; changing a name's case
        // only on a legacy duplicate cannot.
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
      if (patch.visibleColumns !== undefined && !isDeepStrictEqual(patch.visibleColumns, found.visibleColumns ?? null)) {
        found.visibleColumns = patch.visibleColumns;
        changed = true;
      }
      if (!changed) return { view: found, changed };
      // command-coverage-ignore: per-admin saved list preset — personal UI
      // configuration, not a domain mutation.
      await tx.flush();
      return { view: found, changed };
    });
    if (changed) this.logForeignWrite('saved_view.updated', view, actor);
    return toDto(view, actor);
  }

  async remove(id: string, actor: ReturnSavedViewActor): Promise<void> {
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
    actor: ReturnSavedViewActor,
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
      'Saved return list view changed by an admin who does not own it.',
    );
  }
}

/**
 * Serialise this owner's saves on the return list and refuse a name whose key
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
  if (rows.length > 0) {
    throw new HttpError(
      409,
      ERROR_CODES.RETURN_SAVED_VIEW_NAME_TAKEN,
      'You already have a saved view with this name on the return list. Choose a different name.',
    );
  }
}

/**
 * The shape of a `uuid` column value. A view id that does not have it names no
 * view, so it answers the same 404 as an absent one instead of reaching
 * PostgreSQL, whose `invalid input syntax for type uuid` would surface as a
 * 500. Shape only — deliberately looser than RFC 9562's version and variant
 * bits, which PostgreSQL does not check either.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadModifiable(
  tx: EntityManager,
  id: string,
  actor: ReturnSavedViewActor,
): Promise<ReturnListSavedView> {
  if (!UUID_SHAPE.test(id)) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Saved view not found.');
  }
  const view = await tx.findOne(ReturnListSavedView, { id });
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

function toDto(v: ReturnListSavedView, actor: ReturnSavedViewActor): SavedListView {
  const ownedByCaller = v.ownerAdminUserId === actor.adminUserId;
  return {
    id: v.id,
    name: v.name,
    shared: v.shared,
    ownerAdminUserId: v.ownerAdminUserId,
    ownedByCaller,
    canModify: ownedByCaller || (v.shared && actor.isPlatformAdmin),
    filters: v.filters,
    sort: v.sort,
    visibleColumns: v.visibleColumns ?? null,
  };
}
