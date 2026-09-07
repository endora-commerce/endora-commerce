import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { CategoryTreePicker } from '../../../../packages/admin-shell/src/components/category-tree-picker/CategoryTreePicker';
import type { CategoryTreePickerCategory } from '../../../../packages/admin-shell/src/components/category-tree-picker/category-tree-utils';

const CATEGORIES: CategoryTreePickerCategory[] = [
  {
    id: 'parent-1',
    parentCategoryId: null,
    name: { 'en-US': 'Parent One' },
    slug: 'parent-one',
    sortOrder: 1,
  },
  {
    id: 'child-1',
    parentCategoryId: 'parent-1',
    name: { 'en-US': 'Child Leaf' },
    slug: 'child-leaf',
    sortOrder: 1,
  },
];

// `core`, not `catalog` — feature 091 R-1: a translation namespace is module
// knowledge and `@endora-commerce/admin-kit` holds none.
const BUNDLE = passthroughBundle('core', [
  'categoryTreePicker.loading',
  'categoryTreePicker.filter.placeholder',
  'categoryTreePicker.empty.noCategories',
  'categoryTreePicker.empty.noMatches',
  'categoryTreePicker.aria.treeLabel',
  'categoryTreePicker.expand',
  'categoryTreePicker.collapse',
]);

describe('CategoryTreePicker', () => {
  it('shows indeterminate checkbox on parent when only child is selected', () => {
    renderWithI18n(
      <CategoryTreePicker
        categories={CATEGORIES}
        selectedIds={['child-1']}
        onChange={vi.fn()}
      />,
      BUNDLE,
    );

    const parent = screen.getByRole('checkbox', { name: 'Parent One' });
    expect(parent).not.toBeChecked();
    expect(parent.getAttribute('aria-checked')).toBe('mixed');
  });

  it('toggles selection via checkbox', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithI18n(
      <CategoryTreePicker categories={CATEGORIES} selectedIds={[]} onChange={onChange} />,
      BUNDLE,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Parent One' }));
    expect(onChange).toHaveBeenCalledWith(['parent-1']);
  });

  it('expands children when expand control clicked', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <CategoryTreePicker categories={CATEGORIES} selectedIds={[]} onChange={vi.fn()} />,
      BUNDLE,
    );

    expect(screen.queryByRole('checkbox', { name: 'Child Leaf' })).toBeNull();
    const expandButtons = screen.getAllByRole('button', { name: 'categoryTreePicker.expand' });
    await user.click(expandButtons[0]!);
    expect(screen.getByRole('checkbox', { name: 'Child Leaf' })).toBeTruthy();
  });

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithI18n(
      <CategoryTreePicker
        categories={CATEGORIES}
        selectedIds={[]}
        onChange={onChange}
        disabled
      />,
      BUNDLE,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Parent One' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows loading and error states', () => {
    const { rerender } = renderWithI18n(
      <CategoryTreePicker categories={[]} selectedIds={[]} onChange={vi.fn()} loading />,
      BUNDLE,
    );
    expect(screen.getByText('categoryTreePicker.loading')).toBeTruthy();

    rerender(
      <CategoryTreePicker
        categories={[]}
        selectedIds={[]}
        onChange={vi.fn()}
        error="Load failed"
      />,
    );
    expect(screen.getByText('Load failed')).toBeTruthy();
  });

  it('filter narrows visible nodes and clearing keeps selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithI18n(
      <CategoryTreePicker
        categories={CATEGORIES}
        selectedIds={['child-1']}
        onChange={onChange}
      />,
      BUNDLE,
    );

    const filter = screen.getByRole('searchbox');
    await user.type(filter, 'Child');
    expect(screen.getByRole('checkbox', { name: 'Child Leaf' })).toBeChecked();
    await user.clear(filter);
    expect(screen.getByRole('checkbox', { name: 'Child Leaf' })).toBeChecked();
  });
});
