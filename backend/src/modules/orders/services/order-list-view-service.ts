import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { OrderListSavedView } from '../entities/order-list-saved-view.entity.js';

export interface SavedViewInput {
  name: string;
  shared: boolean;
  filters: Record<string, unknown>;
  sort: { field: string; dir: 'asc' | 'desc' };
  visibleColumns?: string[] | null | undefined;
}

/**
 * OrderListViewService — feature 038 (US2, T039).
 *
 * Per-user saved filter/sort presets for the admin orders list. A user sees
 * their own views plus all shared views; editing or deleting a shared view is
 * restricted to its owner (and platform admins).
 */
export class OrderListViewService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /** The caller's own views plus every shared view. */
  async listFor(adminUserId: string): Promise<OrderListSavedView[]> {
    const em = this.emFactory();
    return em.find(
      OrderListSavedView,
      { $or: [{ ownerAdminUserId: adminUserId }, { shared: true }] },
      { orderBy: { name: 'asc' } },
    );
  }

  async create(adminUserId: string, input: SavedViewInput): Promise<OrderListSavedView> {
    const em = this.emFactory();
    // command-coverage-ignore: per-admin saved list preset (filters/sort/columns
    // for the orders list) — personal UI configuration, not an order domain
    // mutation, so it is not an admin-audit target.
    const view = em.create(OrderListSavedView, {
      ownerAdminUserId: adminUserId,
      name: input.name,
      shared: input.shared,
      filters: input.filters,
      sort: input.sort,
      visibleColumns: input.visibleColumns ?? null,
    });
    await em.persistAndFlush(view);
    return view;
  }

  async update(
    id: string,
    adminUserId: string,
    isPlatformAdmin: boolean,
    patch: {
      name?: string | undefined;
      shared?: boolean | undefined;
      filters?: Record<string, unknown> | undefined;
      sort?: { field: string; dir: 'asc' | 'desc' } | undefined;
      visibleColumns?: string[] | null | undefined;
    },
  ): Promise<OrderListSavedView> {
    const em = this.emFactory();
    // command-coverage-ignore: per-admin saved list preset (filters/sort/columns
    // for the orders list) — personal UI configuration, not an order domain
    // mutation, so it is not an admin-audit target.
    const view = await this.loadEditable(em, id, adminUserId, isPlatformAdmin);
    if (patch.name !== undefined) view.name = patch.name;
    if (patch.shared !== undefined) view.shared = patch.shared;
    if (patch.filters !== undefined) view.filters = patch.filters;
    if (patch.sort !== undefined) view.sort = patch.sort;
    if (patch.visibleColumns !== undefined) view.visibleColumns = patch.visibleColumns;
    await em.flush();
    return view;
  }

  async remove(id: string, adminUserId: string, isPlatformAdmin: boolean): Promise<void> {
    const em = this.emFactory();
    // command-coverage-ignore: per-admin saved list preset (filters/sort/columns
    // for the orders list) — personal UI configuration, not an order domain
    // mutation, so it is not an admin-audit target.
    const view = await this.loadEditable(em, id, adminUserId, isPlatformAdmin);
    await em.removeAndFlush(view);
  }

  private async loadEditable(
    em: EntityManager,
    id: string,
    adminUserId: string,
    isPlatformAdmin: boolean,
  ): Promise<OrderListSavedView> {
    const view = await em.findOne(OrderListSavedView, { id });
    if (!view) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Saved view not found.');
    const owns = view.ownerAdminUserId === adminUserId;
    // A shared view may only be edited/deleted by its owner or a platform admin.
    if (view.shared && !owns && !isPlatformAdmin) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only the owner can modify this shared view.');
    }
    if (!view.shared && !owns) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Saved view not found.');
    }
    return view;
  }
}
