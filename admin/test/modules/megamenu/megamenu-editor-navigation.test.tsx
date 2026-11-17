import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import {
  MenuItemConfigPanel,
  type IndexedItem,
} from '../../../../packages/modules/megamenu/src/admin/components/MenuItemConfigPanel';
import { MenuItemTree } from '../../../../packages/modules/megamenu/src/admin/components/MenuItemTree';

/**
 * `specs/168-megamenu-navigation-bar/` FR-021..FR-023 — the editor shows a
 * tab's presentation and alignment, offers the kinds a level allows, sets an
 * audience, configures a category tree, and says when a label is inherited.
 */
// The pickers are stubbed; everything else is the kit's own — `MenuItemTree`
// asks through the real `useConfirmDialog` before deleting (issue #1464).
vi.mock('@endora-commerce/admin-kit/components', async (importOriginal) => {
  const picker =
    (name: string) =>
    ({
      value,
      onChange,
      ariaLabel,
    }: {
      value: string | null;
      onChange: (next: string | null) => void;
      ariaLabel?: string;
    }) => (
      <input
        aria-label={ariaLabel ?? name}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      />
    );
  return {
    ...(await importOriginal<typeof import('@endora-commerce/admin-kit/components')>()),
    CategorySelect: picker('category picker'),
    CmsPagePicker: picker('page picker'),
    CmsBlockPicker: picker('block picker'),
    CustomerGroupPicker: picker('customer group picker'),
    AssetFieldPicker: picker('asset picker'),
  };
});

const bundle = {
  megamenu: JSON.parse(
    readFileSync(resolve(__dirname, '../../../../packages/modules/megamenu/i18n/en.json'), 'utf8'),
  ) as Record<string, string>,
};

function item(over: Partial<IndexedItem>): IndexedItem {
  return {
    id: 'item-1',
    parentId: null,
    position: 0,
    kind: 'external-link',
    labels: { 'pl-PL': 'Usługi' },
    target: { url: 'https://example.com' },
    ...over,
  } as IndexedItem;
}

function renderPanel(current: IndexedItem) {
  const onChange = vi.fn();
  renderWithI18n(<MenuItemConfigPanel item={current} languages={['pl-PL', 'en-US']} onChange={onChange} />, bundle);
  return onChange;
}

const optionValues = (select: HTMLElement): string[] =>
  within(select)
    .getAllByRole('option')
    .map((option) => (option as HTMLOptionElement).value);

describe('MenuItemConfigPanel — navigation bar (feature 168)', () => {
  it('shows a presentation and an alignment for a tab, and saves the choice', () => {
    const onChange = renderPanel(item({ presentation: 'mega', alignment: 'start' }));
    const presentation = screen.getByLabelText('Opens as');
    expect(optionValues(presentation)).toEqual(['link', 'dropdown', 'mega', 'catalog']);
    fireEvent.change(presentation, { target: { value: 'dropdown' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ presentation: 'dropdown' }));
    fireEvent.change(screen.getByLabelText('Position in the bar'), { target: { value: 'end' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ alignment: 'end' }));
  });

  it('shows neither for an item below the top level', () => {
    renderPanel(item({ parentId: 'tab' }));
    expect(screen.queryByLabelText('Opens as')).toBeNull();
    expect(screen.queryByLabelText('Position in the bar')).toBeNull();
  });

  it('offers a tab only the kinds a tab may be, and a child every kind', () => {
    renderPanel(item({ presentation: 'mega' }));
    expect(optionValues(screen.getByLabelText('Type'))).toEqual([
      'group',
      'category-link',
      'cms-page-link',
      'external-link',
      'button',
    ]);
  });

  it('offers a child the group and the category tree as well', () => {
    renderPanel(item({ parentId: 'tab' }));
    expect(optionValues(screen.getByLabelText('Type'))).toEqual([
      'group',
      'category-link',
      'category-tree',
      'cms-page-link',
      'external-link',
      'button',
      'asset',
      'cms-block-embed',
    ]);
  });

  it('sets an audience, and picks customer groups for a group audience', () => {
    const onChange = renderPanel(item({ presentation: 'link' }));
    fireEvent.change(screen.getByLabelText('Visible to'), { target: { value: 'signed_in' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ audience: { kind: 'signed_in' } }));
  });

  it('adds a customer group to a customer-group audience', () => {
    const onChange = renderPanel(
      item({ presentation: 'link', audience: { kind: 'customer_groups', customerGroupIds: ['g-1'] } }),
    );
    fireEvent.change(screen.getByLabelText('Add a customer group'), { target: { value: 'g-2' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ audience: { kind: 'customer_groups', customerGroupIds: ['g-1', 'g-2'] } }),
    );
  });

  it('says that an empty label inherits the target name', () => {
    renderPanel(item({ parentId: 'tab', kind: 'cms-page-link', labels: {}, target: { pageId: 'p' } }));
    expect(screen.getAllByPlaceholderText("Leave empty to use the target's own name")).toHaveLength(2);
  });

  it('configures a category tree by its root and depth', () => {
    const onChange = renderPanel(
      item({ parentId: 'tab', kind: 'category-tree', labels: {}, target: { rootCategoryId: null, depth: 2 } }),
    );
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: { rootCategoryId: null, depth: 3 } }));
    expect(screen.getByText(/whole catalogue/i)).toBeTruthy();
  });
});

describe('MenuItemConfigPanel — a tab that follows its link (feature 168 review)', () => {
  it('names the side-list presentation neutrally', () => {
    renderPanel(item({ presentation: 'catalog' }));
    expect(screen.getByRole('option', { name: 'Panel with side list' })).toBeTruthy();
  });

  it('offers a link tab with a panel to follow its link on click, and saves it', () => {
    const onChange = renderPanel(
      item({ kind: 'category-link', labels: {}, presentation: 'mega', target: { categoryId: 'c' } }),
    );
    fireEvent.click(screen.getByLabelText('Clicking the tab opens its link'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ clickNavigates: true }));
  });

  it('offers it to no group, no link-only tab and no item below the top level', () => {
    for (const current of [
      item({ kind: 'group', target: {}, presentation: 'mega' }),
      item({ presentation: 'link' }),
      item({ parentId: 'tab' }),
    ]) {
      const { unmount } = renderWithI18n(
        <MenuItemConfigPanel item={current} languages={['pl-PL']} onChange={() => {}} />,
        bundle,
      );
      expect(screen.queryByLabelText('Clicking the tab opens its link')).toBeNull();
      unmount();
    }
  });
});

describe('MenuItemTree — audience badge (feature 168)', () => {
  it('marks an item that is not visible to everyone', () => {
    renderWithI18n(
      <MenuItemTree
        items={[
          item({ presentation: 'link' }),
          item({ id: 'item-2', position: 1, presentation: 'link', audience: { kind: 'signed_in' } }),
        ]}
        selectedItemId={null}
        onSelect={() => {}}
        onMove={() => {}}
        onDelete={() => {}}
        onAddChild={() => {}}
      />,
      bundle,
    );
    expect(screen.getAllByText('Signed-in customers')).toHaveLength(1);
  });
});
