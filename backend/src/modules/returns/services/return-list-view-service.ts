import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type { ReturnSavedViewDto } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { ReturnListSavedView } from '../entities/return-list-saved-view.entity.js';

/**
 * ReturnListViewService — feature 046 (US8).
 *
 * Saved admin list presets (filters + sort + visible columns), private to the
 * owner or shared with everyone with list access. Mirrors
 * `OrderListViewService`.
 */
export class ReturnListViewService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async listFor(adminUserId: string): Promise<ReturnSavedViewDto[]> {
    const em = this.emFactory();
    const views = await em.find(
      ReturnListSavedView,
      { $or: [{ ownerAdminUserId: adminUserId }, { shared: true }] },
      { orderBy: { createdAt: 'asc' } },
    );
    return views.map(toDto);
  }

  async create(
    adminUserId: string,
    input: {
      name: string;
      shared?: boolean | undefined;
      filters: Record<string, unknown>;
      sort: { field: string; dir: 'asc' | 'desc' };
      visibleColumns?: string[] | undefined;
    },
  ): Promise<ReturnSavedViewDto> {
    // command-coverage-ignore: saved list views are per-admin UI presets
    // (filters/sort/columns), not audited domain-state.
    const em = this.emFactory();
    const view = em.create(ReturnListSavedView, {
      ownerAdminUserId: adminUserId,
      name: input.name,
      shared: input.shared ?? false,
      filters: input.filters,
      sort: input.sort,
      visibleColumns: input.visibleColumns ?? null,
    });
    await em.persistAndFlush(view);
    return toDto(view);
  }

  async update(
    id: string,
    adminUserId: string,
    patch: {
      name?: string | undefined;
      shared?: boolean | undefined;
      filters?: Record<string, unknown> | undefined;
      sort?: { field: string; dir: 'asc' | 'desc' } | undefined;
      visibleColumns?: string[] | null | undefined;
    },
  ): Promise<ReturnSavedViewDto> {
    // command-coverage-ignore: saved list views are per-admin UI presets, not
    // audited domain-state.
    const em = this.emFactory();
    const view = await em.findOne(ReturnListSavedView, { id });
    if (!view) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Saved view not found.');
    if (view.ownerAdminUserId !== adminUserId) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only the owner can edit this view.');
    }
    if (patch.name !== undefined) view.name = patch.name;
    if (patch.shared !== undefined) view.shared = patch.shared;
    if (patch.filters !== undefined) view.filters = patch.filters;
    if (patch.sort !== undefined) view.sort = patch.sort;
    if (patch.visibleColumns !== undefined) view.visibleColumns = patch.visibleColumns;
    await em.flush();
    return toDto(view);
  }

  async remove(id: string, adminUserId: string): Promise<void> {
    // command-coverage-ignore: saved list views are per-admin UI presets, not
    // audited domain-state.
    const em = this.emFactory();
    const view = await em.findOne(ReturnListSavedView, { id });
    if (!view) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Saved view not found.');
    if (view.ownerAdminUserId !== adminUserId) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only the owner can delete this view.');
    }
    await em.removeAndFlush(view);
  }
}

function toDto(v: ReturnListSavedView): ReturnSavedViewDto {
  return {
    id: v.id,
    name: v.name,
    shared: v.shared,
    filters: v.filters,
    sort: v.sort,
    visibleColumns: v.visibleColumns ?? null,
  };
}
