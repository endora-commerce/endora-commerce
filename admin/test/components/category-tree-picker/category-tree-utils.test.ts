import { describe, expect, it } from 'vitest';
import {
  ancestorIdsForSelected,
  buildCategoryTree,
  computeParentIndeterminateIds,
  filterCategoryTree,
  flattenCategoryTree,
  pickCategoryDisplayName,
  type CategoryTreePickerCategory,
} from '../../../src/components/category-tree-picker/category-tree-utils';

const SAMPLE: CategoryTreePickerCategory[] = [
  {
    id: 'root-b',
    parentCategoryId: null,
    name: { 'en-US': 'Bravo' },
    slug: 'bravo',
    sortOrder: 2,
  },
  {
    id: 'root-a',
    parentCategoryId: null,
    name: { 'en-US': 'Alpha' },
    slug: 'alpha',
    sortOrder: 1,
  },
  {
    id: 'child-z',
    parentCategoryId: 'root-a',
    name: { 'en-US': 'Zulu child' },
    slug: 'zulu',
    sortOrder: 2,
  },
  {
    id: 'child-y',
    parentCategoryId: 'root-a',
    name: { 'pl-PL': 'Żółć' },
    slug: 'zolc',
    sortOrder: 1,
  },
];

describe('category-tree-utils', () => {
  it('buildCategoryTree sorts siblings by sortOrder then slug', () => {
    const tree = buildCategoryTree(SAMPLE);
    expect(tree.map((n) => n.category.id)).toEqual(['root-a', 'root-b']);
    expect(tree[0]?.children.map((n) => n.category.id)).toEqual(['child-y', 'child-z']);
    expect(tree[0]?.children[0]?.depth).toBe(1);
  });

  it('flattenCategoryTree walks depth-first', () => {
    const flat = flattenCategoryTree(buildCategoryTree(SAMPLE));
    expect(flat.map((n) => n.category.id)).toEqual(['root-a', 'child-y', 'child-z', 'root-b']);
  });

  it('pickCategoryDisplayName prefers locale then en-US then slug', () => {
    expect(pickCategoryDisplayName({ 'pl-PL': 'Żółć' }, 'zolc', 'pl-PL')).toBe('Żółć');
    expect(pickCategoryDisplayName({ 'en-US': 'Alpha' }, 'alpha', 'pl-PL')).toBe('Alpha');
    expect(pickCategoryDisplayName({}, 'fallback-slug', 'en-US')).toBe('fallback-slug');
  });

  it('filterCategoryTree matches diacritic-insensitive and keeps ancestors', () => {
    const tree = buildCategoryTree(SAMPLE);
    const filtered = filterCategoryTree(tree, 'zolc', 'pl-PL');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.category.id).toBe('root-a');
    expect(filtered[0]?.children).toHaveLength(1);
    expect(filtered[0]?.children[0]?.category.id).toBe('child-y');
  });

  it('filterCategoryTree with empty query returns full tree', () => {
    const tree = buildCategoryTree(SAMPLE);
    expect(filterCategoryTree(tree, '', 'en-US')).toEqual(tree);
  });

  it('computeParentIndeterminateIds marks ancestors of deep selection', () => {
    const tree = buildCategoryTree(SAMPLE);
    const selected = new Set(['child-z']);
    const indeterminate = computeParentIndeterminateIds(tree, selected);
    expect(indeterminate.has('root-a')).toBe(true);
    expect(indeterminate.has('child-z')).toBe(false);
  });

  it('ancestorIdsForSelected returns parent chain', () => {
    const ancestors = ancestorIdsForSelected(SAMPLE, new Set(['child-z']));
    expect(ancestors.has('root-a')).toBe(true);
    expect(ancestors.has('child-z')).toBe(false);
  });
});
