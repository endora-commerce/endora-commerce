import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { CommandContext } from '@endora-commerce/platform/commands';
import { Category } from '../entities/category.entity.js';
import { CatalogCategoryCommandService } from '../services/catalog-category-command-port.js';
import type { CategoryAdminService } from '../services/category-admin.service.js';
import { withCallerOptions } from './caller-options.js';
import {
  makeSetCategoryInventoryThresholdsCommand,
  makeUpdateCategoryCommand,
} from './category.commands.js';

/**
 * `specs/186-aggregate-ports/` US8 (issue #1826) — the pieces of the Category
 * aggregate's Commands and port that need no database: the threshold Command's
 * "nothing changed, nothing recorded" (research R-20.3), the copy a custom-field
 * merge is handed, and the port's call-level refusals, raised before the runner
 * is reached. The writes themselves are `[PG]`:
 * `backend/test/contract/catalog/catalog-category-command-port.test.ts`.
 */

const ID = '00000000-0000-4000-8000-0000000c0001';

function categoryRow(overrides: Partial<Category> = {}): Category {
  return Object.assign(new Category(), {
    id: ID,
    parentCategoryId: null,
    name: { en: 'Bolts' },
    slug: 'bolts',
    sortOrder: 0,
    isActive: true,
    customFieldValues: { note: 'kept' },
    inventoryThresholdHigh: 10,
    inventoryThresholdMedium: null,
    inventoryThresholdLow: 1,
    deletedAt: null,
    ...overrides,
  });
}

function contextFor(row: Category): { ctx: CommandContext; flush: ReturnType<typeof vi.fn> } {
  const flush = vi.fn(async () => undefined);
  const em = { findOne: vi.fn(async () => row), count: vi.fn(async () => 0), flush } as unknown as EntityManager;
  return {
    ctx: { em, actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' } },
    flush,
  };
}

describe('category.inventory_thresholds.set', () => {
  it('records the three columns before and after', async () => {
    const row = categoryRow();
    const { ctx, flush } = contextFor(row);
    const outcome = await makeSetCategoryInventoryThresholdsCommand({ categoryId: ID, patch: { high: 20, medium: 5 } }).run(ctx);
    expect(outcome.skipAudit).toBeUndefined();
    expect(outcome.before).toEqual({ inventoryThresholdHigh: 10, inventoryThresholdMedium: null, inventoryThresholdLow: 1 });
    expect(outcome.after).toEqual({ inventoryThresholdHigh: 20, inventoryThresholdMedium: 5, inventoryThresholdLow: 1 });
    expect(flush).toHaveBeenCalledOnce();
  });

  it('writes and records nothing for a patch that changes nothing', async () => {
    const row = categoryRow();
    const { ctx, flush } = contextFor(row);
    const command = withCallerOptions(
      makeSetCategoryInventoryThresholdsCommand({ categoryId: ID, patch: { high: 10, medium: null } }),
      { source: 'inventory' },
    );
    const outcome = await command.run(ctx);
    expect(outcome.skipAudit).toBe(true);
    expect(outcome.after).toBeUndefined();
    expect(flush).not.toHaveBeenCalled();
  });

  it('refuses a malformed id 404 before reading', async () => {
    const { ctx } = contextFor(categoryRow());
    await expect(
      makeSetCategoryInventoryThresholdsCommand({ categoryId: 'nope', patch: { high: 1 } }).run(ctx),
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
  });
});

describe('category.update — the custom-field merge', () => {
  it('hands the merge a copy of the stored bag and stores its answer', async () => {
    const row = categoryRow();
    const stored = row.customFieldValues;
    const { ctx } = contextFor(row);
    const merge = vi.fn(async (current: Record<string, unknown>) => {
      current['note'] = 'mutated in place';
      return { ...current, extra: 1 };
    });
    await makeUpdateCategoryCommand(
      { linkableAssets: () => ({}) as never },
      { categoryId: ID, patch: {}, customFields: merge },
    ).run(ctx);
    expect(stored).toEqual({ note: 'kept' });
    expect(row.customFieldValues).toEqual({ note: 'mutated in place', extra: 1 });
  });

  it('announces category.updated.v1 for the subtree re-index and the navigation flush', () => {
    const command = makeUpdateCategoryCommand({ linkableAssets: () => ({}) as never }, { categoryId: ID, patch: {} });
    expect(command.event?.(categoryRow())).toMatchObject({
      eventName: 'category.updated.v1',
      payload: { categoryId: ID },
    });
  });
});

describe('catalogCategoryCommandPort — call-level refusals', () => {
  const service = {
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    setCustomFieldValues: vi.fn(),
    setInventoryThresholds: vi.fn(),
  };
  const port = new CatalogCategoryCommandService(() => service as unknown as CategoryAdminService);

  it('refuses a malformed source 422 before the runner is reached', async () => {
    await expect(port.delete(ID, { source: 'Not A Code' })).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    await expect(port.move(ID, { parentId: null }, { source: '' })).rejects.toMatchObject({ statusCode: 422 });
    expect(service.softDelete).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });

  it('refuses an input outside the admin schema 422 with a field error', async () => {
    await expect(port.update(ID, { slug: 'Not Kebab' })).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [expect.objectContaining({ path: 'slug' })],
    });
    await expect(port.move(ID, { parentId: null, position: 1.5 })).rejects.toMatchObject({ statusCode: 422 });
    await expect(port.setInventoryThresholds(ID, { high: 'x' } as never)).rejects.toMatchObject({ statusCode: 422 });
    expect(service.update).not.toHaveBeenCalled();
    expect(service.setInventoryThresholds).not.toHaveBeenCalled();
  });

  it('moves as an update of the parent, the sort order only when given', async () => {
    service.update.mockResolvedValue(categoryRow());
    await port.move(ID, { parentId: null }, { source: 'pim' });
    expect(service.update).toHaveBeenLastCalledWith(ID, { parentCategoryId: null }, { source: 'pim', extensions: undefined });
    await port.move(ID, { parentId: ID, position: 3 });
    expect(service.update).toHaveBeenLastCalledWith(
      ID,
      { parentCategoryId: ID, sortOrder: 3 },
      { source: undefined, extensions: undefined },
    );
  });
});
