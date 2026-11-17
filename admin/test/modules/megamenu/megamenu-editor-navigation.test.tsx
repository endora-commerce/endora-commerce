import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
vi.mock('@endora-commerce/admin-kit/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  // A picker named by its own `ariaLabel`, or — when the panel wires it to a
  // `<label for>` through `id` — by that label, as the real pickers are.
  const picker =
    (name: string) =>
    ({
      value,
      onChange,
      ariaLabel,
      id,
    }: {
      value: string | null;
      onChange: (next: string | null) => void;
      ariaLabel?: string;
      id?: string;
    }) => (
      <input
        id={id}
        {...(id === undefined ? { 'aria-label': ariaLabel ?? name } : {})}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      />
    );
  return {
    ...actual,
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

describe('MenuItemConfigPanel — targets named in the operator\'s words (UX audit CONTENT-17, #1467)', () => {
  it('labels the category picker "Category" and wires the label to it', () => {
    const onChange = renderPanel(item({ parentId: 'tab', kind: 'category-link', labels: {}, target: { categoryId: '' } }));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: { categoryId: 'cat-1' } }));
  });

  it('labels the CMS page picker "Page"', () => {
    renderPanel(item({ parentId: 'tab', kind: 'cms-page-link', labels: {}, target: { pageId: '' } }));
    expect(screen.getByLabelText('Page')).toBeTruthy();
  });

  it('labels the CMS block picker "Content block"', () => {
    renderPanel(item({ parentId: 'tab', kind: 'cms-block-embed', labels: {}, target: { blockId: '', embedSide: 'right' } }));
    expect(screen.getByLabelText('Content block')).toBeTruthy();
  });

  it('names the asset picker after the chosen kind: "Image", or "Video"', () => {
    const { unmount } = renderWithI18n(
      <MenuItemConfigPanel
        item={item({ parentId: 'tab', kind: 'asset', labels: {}, target: { assetId: '', kind: 'image' } })}
        languages={['pl-PL']}
        onChange={() => {}}
      />,
      bundle,
    );
    expect(screen.getByLabelText('Image')).toBeTruthy();
    unmount();
    renderPanel(item({ parentId: 'tab', kind: 'asset', labels: {}, target: { assetId: '', kind: 'video' } }));
    expect(screen.getByLabelText('Video')).toBeTruthy();
  });

  it('shows no "id" in any target label', () => {
    for (const key of Object.keys(bundle.megamenu).filter((k) => k.startsWith('fields.'))) {
      expect(bundle.megamenu[key], key).not.toMatch(/\bid\b/i);
    }
  });
});

describe('MenuItemTree — row actions (UX audit CONTENT-17, #1467)', () => {
  function renderTree(over: { onDelete?: () => void; onAddChild?: () => void } = {}) {
    renderWithI18n(
      <MenuItemTree
        items={[
          item({ presentation: 'link', labels: { 'pl-PL': 'Usługi' } }),
          item({ id: 'item-2', position: 1, presentation: 'link', labels: { 'pl-PL': 'Kontakt' } }),
        ]}
        selectedItemId={null}
        onSelect={() => {}}
        onMove={() => {}}
        onDelete={over.onDelete ?? (() => {})}
        onAddChild={over.onAddChild ?? (() => {})}
      />,
      bundle,
    );
  }

  it('names the move buttons and disables the move that has nowhere to go', () => {
    renderTree();
    const up = screen.getAllByRole('button', { name: 'Move up' });
    const down = screen.getAllByRole('button', { name: 'Move down' });
    expect(up).toHaveLength(2);
    expect(up[0]).toBeDisabled();
    expect(up[1]).toBeEnabled();
    expect(down[0]).toBeEnabled();
    expect(down[1]).toBeDisabled();
  });

  it('gives each icon button at least a 24 px target (WCAG 2.5.8)', () => {
    renderTree();
    for (const button of screen.getAllByRole('button', { name: /^Move (up|down)$/ })) {
      expect(button.className).toMatch(/\bh-8\b/);
      expect(button.className).toMatch(/\bw-8\b/);
    }
  });

  it('moves adding a child and deleting into a named row menu, delete last', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onAddChild = vi.fn();
    renderTree({ onDelete, onAddChild });
    expect(screen.queryByRole('button', { name: 'Delete item' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Actions for Kontakt' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(['Add child item', 'Delete item']);
    await user.click(screen.getByRole('menuitem', { name: 'Delete item' }));
    expect(onDelete).toHaveBeenCalledWith('item-2');
  });
});
