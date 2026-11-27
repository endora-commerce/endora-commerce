import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  CatalogAttributeCommandPort,
  CatalogAttributeOptionCreateInput,
  CatalogAttributeOptionPatch,
  CatalogAttributeOptionResult,
  CatalogAttributeView,
  CatalogProductCommandPort,
  CatalogProductRecord,
  CatalogProductUpdateInput,
  CatalogProductVariantRecord,
  CatalogProductWritePort,
  CreateAttributeRequest,
  CreateProductRequest,
  UpdateProductRequest,
} from './catalog.js';
import type { ProductScopedWriteInput, ProductScopedWriteResult } from './product-scopes.js';

/**
 * `specs/186-aggregate-ports/` T070 (issue #1825) — the Product aggregate port
 * and the attribute-definition port: one method per operation of
 * `contracts/catalog-product-command-port.md`, each ending in the aggregate
 * ports' options.
 */
describe('CatalogProductCommandPort (186 US6)', () => {
  it('declares the operations of the Product aggregate', () => {
    expectTypeOf<keyof CatalogProductCommandPort>().toEqualTypeOf<
      | 'create'
      | 'update'
      | 'archive'
      | 'restore'
      | 'delete'
      | 'createVariant'
      | 'updateVariant'
      | 'deleteVariant'
      | 'setCustomFieldValues'
      | 'applyScopedValues'
    >();
  });

  it('takes the admin bodies, the version moved into the options', () => {
    expectTypeOf<CatalogProductCommandPort['create']>().toEqualTypeOf<
      (req: CreateProductRequest, options?: AggregateCommandOptions) => Promise<CatalogProductRecord>
    >();
    expectTypeOf<CatalogProductUpdateInput>().toEqualTypeOf<Omit<UpdateProductRequest, 'version'>>();
    expectTypeOf<keyof CatalogProductUpdateInput>().not.toEqualTypeOf<'version'>();
    expectTypeOf<CatalogProductCommandPort['createVariant']>().returns.resolves.toEqualTypeOf<CatalogProductVariantRecord>();
  });

  it('writes the attribute values through the shared merge, and the scoped cells of the connector port', () => {
    expectTypeOf<CatalogProductCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<CatalogProductRecord>
    >();
    expectTypeOf<CatalogProductCommandPort['applyScopedValues']>().toEqualTypeOf<
      (id: string, input: ProductScopedWriteInput, options?: AggregateCommandOptions) => Promise<ProductScopedWriteResult>
    >();
  });
});

describe('CatalogAttributeCommandPort (186 US6)', () => {
  it('declares the attribute-definition operations', () => {
    expectTypeOf<keyof CatalogAttributeCommandPort>().toEqualTypeOf<
      'create' | 'update' | 'delete' | 'addOption' | 'updateOption' | 'deleteOption'
    >();
    expectTypeOf<CatalogAttributeCommandPort['create']>().toEqualTypeOf<
      (req: CreateAttributeRequest, options?: AggregateCommandOptions) => Promise<CatalogAttributeView>
    >();
  });

  it('keeps the deprecated port’s option inputs, now named', () => {
    expectTypeOf<Parameters<CatalogProductWritePort['addAttributeOption']>[1]>().toEqualTypeOf<CatalogAttributeOptionCreateInput>();
    expectTypeOf<Parameters<CatalogProductWritePort['patchAttributeOption']>[1]>().toEqualTypeOf<CatalogAttributeOptionPatch>();
    expectTypeOf<CatalogAttributeCommandPort['addOption']>().returns.resolves.toEqualTypeOf<CatalogAttributeOptionResult>();
  });
});
