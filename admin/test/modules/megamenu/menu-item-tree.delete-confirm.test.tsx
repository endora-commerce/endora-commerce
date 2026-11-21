import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MegamenuItem } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { MenuItemTree } from '../../../../packages/modules/megamenu/src/admin/components/MenuItemTree';

/**
 * Issue #1464 (UX audit CONTENT-06) — the tree's trash button removed an item
 * **with its whole subtree** on one click, and nothing said the change was
 * only local until the tree is saved. It now asks first, naming the item, how
 * many nested items go with it, and that the storefront is untouched until Save.
 */

installOffsetParentShim();

function bundle(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  const read = (path: string): Record<string, string> =>
    JSON.parse(readFileSync(resolve(__dirname, path), 'utf8')) as Record<string, string>;
  return {
    megamenu: read(`../../../../packages/modules/megamenu/i18n/${language}.json`),
    core: read(`../../../../packages/modules/_i18n/i18n/${language}.json`),
  };
}

function item(id: string, parentId: string | null, label: string, position = 0): MegamenuItem {
  return { id, parentId, position, kind: 'external-link', labels: { 'en-US': label }, target: { url: 'https://x.test' } } as MegamenuItem;
}

const ITEMS = [
  item('root', null, 'Products'),
  item('a', 'root', 'Tools', 0),
  item('b', 'root', 'Parts', 1),
  item('c', 'a', 'Drills'),
  item('leaf', null, 'Contact', 1),
];

function renderTree(language: 'en' | 'pl' = 'en'): ReturnType<typeof vi.fn> {
  const onDelete = vi.fn();
  renderWithI18n(
    <MenuItemTree items={ITEMS} selectedItemId={null} onSelect={vi.fn()} onMove={vi.fn()} onDelete={onDelete} onAddChild={vi.fn()} />,
    bundle(language),
    { language },
  );
  return onDelete;
}

/** Opens the row's action menu (CONTENT-17, #1467) and picks its delete item. */
async function chooseDelete(label: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^(Actions for |Akcje: )${label}$`) }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /Delete item|Usuń element/ }));
}

describe('MenuItemTree — deleting asks first (#1464)', () => {
  it('names the item and its nested items, opens on Cancel, and Cancel deletes nothing', async () => {
    const onDelete = renderTree();
    await chooseDelete('Products');

    const dialog = await screen.findByRole('dialog', { name: 'Delete this menu item?' });
    expect(dialog).toHaveTextContent('“Products” and the 3 items nested under it');
    expect(dialog).toHaveTextContent('until you save.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes the subtree on confirm', async () => {
    const onDelete = renderTree();
    await chooseDelete('Products');
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete with nested items' }));
    expect(onDelete).toHaveBeenCalledWith('root');
  });

  it('asks without a nested count for a leaf', async () => {
    const onDelete = renderTree();
    await chooseDelete('Contact');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('“Contact” is removed from the tree.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete item' }));
    expect(onDelete).toHaveBeenCalledWith('leaf');
  });

  it('uses the Polish plural forms', async () => {
    renderTree('pl');
    await chooseDelete('Products');
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć ten element menu?' });
    expect(dialog).toHaveTextContent('„Products” i 3 zagnieżdżone w nim elementy');
  });
});
