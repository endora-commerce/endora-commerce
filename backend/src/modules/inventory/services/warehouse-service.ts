import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { DictionaryReferenceError, type DictionaryValidator } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { dispatchValidatorMode } from '../../dictionaries/services/dispatch-validator-mode.js';
import {
  Warehouse,
  DEFAULT_WAREHOUSE_CODE,
  type WarehouseAddress,
} from '../entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../entities/warehouse-channel-assignment.entity.js';
import { StockLevel } from '../entities/stock-level.entity.js';

export interface WarehouseContact {
  name?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
}

export interface CreateWarehouseInput {
  name: string;
  code: string;
  active?: boolean;
  description?: string | null;
  address?: WarehouseAddress | null;
  contact?: WarehouseContact | null;
  defaultLowStockThreshold?: number | null;
}

export interface UpdateWarehouseInput {
  name?: string;
  active?: boolean;
  description?: string | null;
  address?: WarehouseAddress | null;
  contact?: WarehouseContact | null;
  defaultLowStockThreshold?: number | null;
}

export interface WarehouseTotals {
  products: number;
  onHand: number;
  isDefaultForChannelCount: number;
}

export interface WarehouseDTO {
  id: string;
  name: string;
  code: string;
  active: boolean;
  description: string | null;
  address: WarehouseAddress | null;
  contact: WarehouseContact | null;
  defaultLowStockThreshold: number | null;
  totals?: WarehouseTotals;
  createdAt: string;
  updatedAt: string;
}

/**
 * WarehouseService (US1) — admin-side CRUD + lifecycle for warehouses.
 *
 * The seeded `Default` warehouse is treated as a first-class row but
 * carries two extra invariants:
 *   - its `code` cannot change (callers can't supply it on update);
 *   - it cannot be deleted while it is the default for any channel.
 *
 * Stock-bearing warehouses (any row in `stock_levels` referencing the
 * warehouse) likewise refuse delete; admins must move stock first.
 */
export class WarehouseService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly dictionaryValidator?: DictionaryValidator,
  ) {}

  async list(options: {
    page?: number;
    pageSize?: number;
    activeOnly?: boolean;
    withTotals?: boolean;
  } = {}): Promise<{ items: WarehouseDTO[]; page: number; pageSize: number; total: number }> {
    const em = this.emFactory();
    const page = Math.max(0, options.page ?? 0);
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 50), 200);
    const where: Record<string, unknown> = {};
    if (options.activeOnly) where['active'] = true;

    const [rows, total] = await em.findAndCount(Warehouse, where, {
      orderBy: { createdAt: 'asc' },
      offset: page * pageSize,
      limit: pageSize,
    });

    let totalsByWarehouse = new Map<string, WarehouseTotals>();
    if (options.withTotals && rows.length > 0) {
      totalsByWarehouse = await this.collectTotals(em, rows.map((r) => r.id));
    }

    return {
      items: rows.map((r) => this.toDTO(r, totalsByWarehouse.get(r.id))),
      page,
      pageSize,
      total,
    };
  }

  async getById(id: string, options: { withTotals?: boolean } = {}): Promise<WarehouseDTO | null> {
    const em = this.emFactory();
    const row = await em.findOne(Warehouse, { id });
    if (!row) return null;
    if (!options.withTotals) return this.toDTO(row);
    const totals = await this.collectTotals(em, [row.id]);
    return this.toDTO(row, totals.get(row.id));
  }

  async create(input: CreateWarehouseInput): Promise<WarehouseDTO> {
    if (input.address?.countryCode) {
      await this.validateCountry(input.address.countryCode, 'create-or-change');
    }
    const em = this.emFactory();
    const row = em.create(Warehouse, {
      name: input.name,
      code: input.code,
      active: input.active ?? true,
      description: input.description ?? null,
      address: input.address ?? null,
      contactName: input.contact?.name ?? null,
      contactEmail: input.contact?.email ?? null,
      contactPhone: input.contact?.phone ?? null,
      defaultLowStockThreshold: input.defaultLowStockThreshold ?? null,
    });
    try {
      await em.persistAndFlush(row);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(409, 'WAREHOUSE_CODE_TAKEN', 'Warehouse code already in use');
      }
      throw err;
    }
    return this.toDTO(row);
  }

  async update(id: string, input: UpdateWarehouseInput): Promise<WarehouseDTO> {
    const em = this.emFactory();
    const row = await em.findOne(Warehouse, { id });
    if (!row) throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');

    if (input.address?.countryCode) {
      await this.validateCountry(
        input.address.countryCode,
        dispatchValidatorMode(row.address?.countryCode, input.address.countryCode),
      );
    }
    if (input.name !== undefined) row.name = input.name;
    if (input.active !== undefined) row.active = input.active;
    if (input.description !== undefined) row.description = input.description;
    if (input.address !== undefined) row.address = input.address;
    if (input.contact !== undefined) {
      row.contactName = input.contact?.name ?? null;
      row.contactEmail = input.contact?.email ?? null;
      row.contactPhone = input.contact?.phone ?? null;
    }
    if (input.defaultLowStockThreshold !== undefined) {
      row.defaultLowStockThreshold = input.defaultLowStockThreshold;
    }
    await em.persistAndFlush(row);
    return this.toDTO(row);
  }

  private async validateCountry(
    countryCode: string,
    mode: 'create-or-change' | 'unchanged',
  ): Promise<void> {
    if (!this.dictionaryValidator) return;
    try {
      await this.dictionaryValidator.validateCountryCode(countryCode, mode);
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw new HttpError(
          409,
          err.code,
          err.code === 'DICTIONARY_ENTRY_INACTIVE'
            ? `Country code ${err.entryCode} is no longer available for warehouses.`
            : `Country code ${err.entryCode} is not recognised.`,
          [{ path: 'address.countryCode', issue: err.code }],
        );
      }
      throw err;
    }
  }

  async deactivate(id: string): Promise<WarehouseDTO> {
    return this.update(id, { active: false });
  }

  async reactivate(id: string): Promise<WarehouseDTO> {
    return this.update(id, { active: true });
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Warehouse, { id });
    if (!row) throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');

    if (row.code === DEFAULT_WAREHOUSE_CODE) {
      throw new HttpError(409, 'WAREHOUSE_CANNOT_DELETE_DEFAULT', 'The Default warehouse cannot be deleted');
    }

    const defaultForChannels = await em.count(WarehouseChannelAssignment, {
      warehouseId: id,
      isDefault: true,
    });
    if (defaultForChannels > 0) {
      throw new HttpError(
        409,
        'WAREHOUSE_IS_DEFAULT_FOR_CHANNELS',
        `Warehouse is the default for ${defaultForChannels} sales channel(s); promote another warehouse first`,
      );
    }

    const stockRows = await em.count(StockLevel, { warehouseId: id });
    if (stockRows > 0) {
      throw new HttpError(
        409,
        'WAREHOUSE_HAS_STOCK',
        `Warehouse holds stock for ${stockRows} product line(s); move stock to another warehouse first`,
      );
    }

    // Drop any (non-default) channel assignments that still reference the
    // warehouse so the FK doesn't block the delete.
    await em.nativeDelete(WarehouseChannelAssignment, { warehouseId: id });
    await em.removeAndFlush(row);
  }

  private async collectTotals(em: EntityManager, ids: string[]): Promise<Map<string, WarehouseTotals>> {
    const knex = em.getKnex();
    const [stockTotals, defaultCounts] = await Promise.all([
      knex('stock_levels')
        .whereIn('warehouse_id', ids)
        .select('warehouse_id')
        .count<{ warehouse_id: string; products: string }[]>({ products: '*' })
        .sum<{ warehouse_id: string; on_hand: string }[]>({ on_hand: 'on_hand' })
        .groupBy('warehouse_id'),
      knex('warehouse_channel_assignments')
        .whereIn('warehouse_id', ids)
        .where('is_default', true)
        .select('warehouse_id')
        .count<{ warehouse_id: string; default_count: string }[]>({ default_count: '*' })
        .groupBy('warehouse_id'),
    ]);
    const map = new Map<string, WarehouseTotals>();
    for (const id of ids) {
      map.set(id, { products: 0, onHand: 0, isDefaultForChannelCount: 0 });
    }
    for (const row of stockTotals as Array<{
      warehouse_id: string;
      products: string | number;
      on_hand: string | number | null;
    }>) {
      const t = map.get(row.warehouse_id);
      if (!t) continue;
      t.products = Number(row.products);
      t.onHand = Number(row.on_hand ?? 0);
    }
    for (const row of defaultCounts as Array<{
      warehouse_id: string;
      default_count: string | number;
    }>) {
      const t = map.get(row.warehouse_id);
      if (!t) continue;
      t.isDefaultForChannelCount = Number(row.default_count);
    }
    return map;
  }

  private toDTO(row: Warehouse, totals?: WarehouseTotals): WarehouseDTO {
    const contact: WarehouseContact | null =
      row.contactName || row.contactEmail || row.contactPhone
        ? {
            name: row.contactName ?? null,
            email: row.contactEmail ?? null,
            phone: row.contactPhone ?? null,
          }
        : null;
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      active: row.active,
      description: row.description ?? null,
      address: row.address ?? null,
      contact,
      defaultLowStockThreshold: row.defaultLowStockThreshold ?? null,
      ...(totals ? { totals } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
