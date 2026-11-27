import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  CatalogCategoryCommandPort,
  CatalogCategoryRecord,
  CategoryInventoryThresholdPatch,
  CategoryMoveInput,
  CreateCategoryRequest,
  UpdateCategoryInput,
} from './catalog.js';

/**
 * Issue #1826 (`specs/186-aggregate-ports/` T082,
 * `contracts/catalog-category-command-port.md`) — the Category aggregate's
 * write port: six methods, each taking the admin route's input and
 * {@link AggregateCommandOptions} last. No method is optional
 * (`check:port-shape`), and the list read is the read port's, not here.
 */
describe('CatalogCategoryCommandPort', () => {
  it('publishes exactly the six operations', () => {
    expectTypeOf<keyof CatalogCategoryCommandPort>().toEqualTypeOf<
      'create' | 'update' | 'move' | 'delete' | 'setCustomFieldValues' | 'setInventoryThresholds'
    >();
  });

  it('takes the admin routes’ inputs and answers the record', () => {
    expectTypeOf<CatalogCategoryCommandPort['create']>().toEqualTypeOf<
      (input: CreateCategoryRequest, options?: AggregateCommandOptions) => Promise<CatalogCategoryRecord>
    >();
    expectTypeOf<CatalogCategoryCommandPort['update']>().toEqualTypeOf<
      (id: string, input: UpdateCategoryInput, options?: AggregateCommandOptions) => Promise<CatalogCategoryRecord>
    >();
    expectTypeOf<CatalogCategoryCommandPort['move']>().toEqualTypeOf<
      (id: string, input: CategoryMoveInput, options?: AggregateCommandOptions) => Promise<CatalogCategoryRecord>
    >();
    expectTypeOf<CatalogCategoryCommandPort['delete']>().toEqualTypeOf<
      (id: string, options?: AggregateCommandOptions) => Promise<void>
    >();
    expectTypeOf<CatalogCategoryCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<CatalogCategoryRecord>
    >();
    expectTypeOf<CatalogCategoryCommandPort['setInventoryThresholds']>().toEqualTypeOf<
      (
        id: string,
        patch: CategoryInventoryThresholdPatch,
        options?: AggregateCommandOptions,
      ) => Promise<CatalogCategoryRecord>
    >();
  });

  it('moves to a parent or to the root, the position optional', () => {
    expectTypeOf<CategoryMoveInput['parentId']>().toEqualTypeOf<string | null>();
    expectTypeOf<CategoryMoveInput>().toMatchTypeOf<{ readonly parentId: string | null }>();
    expectTypeOf<{ parentId: null }>().toMatchTypeOf<CategoryMoveInput>();
  });
});
