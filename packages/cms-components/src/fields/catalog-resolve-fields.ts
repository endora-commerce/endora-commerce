import type { Fields } from '@measured/puck';
import type { CategoryGridProps, CategoryListProps, ProductGridProps, ProductSliderProps } from '../schema/component-types.js';

export function resolveProductSourceFields(
  fields: Fields<ProductGridProps | ProductSliderProps>,
  source: string,
): Fields<ProductGridProps | ProductSliderProps> {
  const next: Record<string, unknown> = { ...fields };
  delete next['productSlugs'];
  delete next['categorySlug'];
  delete next['searchQuery'];
  delete next['limit'];

  if (source === 'manual' && fields.productSlugs) {
    next['productSlugs'] = fields.productSlugs;
  }
  if (source === 'category') {
    if (fields.categorySlug) next['categorySlug'] = fields.categorySlug;
    if (fields.limit) next['limit'] = fields.limit;
  }
  if (source === 'query') {
    if (fields.searchQuery) next['searchQuery'] = fields.searchQuery;
    if (fields.limit) next['limit'] = fields.limit;
  }

  return next as Fields<ProductGridProps | ProductSliderProps>;
}

export function resolveCategorySelectionFields(
  fields: Fields<CategoryListProps | CategoryGridProps>,
  selectionMode: string,
): Fields<CategoryListProps | CategoryGridProps> {
  const next: Record<string, unknown> = { ...fields };
  delete next['categorySlugs'];
  delete next['parentSlug'];
  delete next['maxDepth'];

  if (selectionMode === 'manual' && fields.categorySlugs) {
    next['categorySlugs'] = fields.categorySlugs;
  }
  if (selectionMode === 'childrenOf' && fields.parentSlug) {
    next['parentSlug'] = fields.parentSlug;
  }
  if (selectionMode === 'all' && fields.maxDepth) {
    next['maxDepth'] = fields.maxDepth;
  }

  return next as Fields<CategoryListProps | CategoryGridProps>;
}
