import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { orphanLabels } from '../../helpers/orphan-labels';
import {
  MenuItemConfigPanel,
  type IndexedItem,
} from '../../../../packages/modules/megamenu/src/admin/components/MenuItemConfigPanel';

/**
 * Issue #1465 (UX audit CONTENT-07): every field of the item editor is named
 * by the label above it — a `<label>` with no `for` names nothing, so a screen
 * reader announced "edit text" for the URL, the link target and the selects.
 */
vi.mock('@endora-commerce/admin-kit/components', () => {
  const picker =
    (name: string) =>
    ({
      id,
      value,
      onChange,
      ariaLabel,
    }: {
      id?: string;
      value: string | null;
      onChange: (next: string | null) => void;
      ariaLabel?: string;
    }) => (
      <input id={id} aria-label={ariaLabel ?? name} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} />
    );
  return {
    CategorySelect: picker('category picker'),
    CmsPagePicker: picker('page picker'),
    CmsBlockPicker: picker('block picker'),
    CustomerGroupPicker: picker('customer group picker'),
    AssetFieldPicker: picker('asset picker'),
  };
});

const en = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../packages/modules/megamenu/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function copy(key: string): string {
  const value = en[key];
  if (value === undefined) throw new Error(`megamenu/i18n/en.json carries no "${key}"`);
  return value;
}

function renderPanel(over: Partial<IndexedItem>): void {
  const item = {
    id: 'item-1',
    parentId: 'tab',
    position: 0,
    kind: 'external-link',
    labels: { 'pl-PL': 'Usługi' },
    target: { url: 'https://example.com' },
    ...over,
  } as IndexedItem;
  renderWithI18n(<MenuItemConfigPanel item={item} languages={['pl-PL', 'en-US']} onChange={vi.fn()} />, { megamenu: en });
}

describe('MenuItemConfigPanel — every field named by its label (#1465)', () => {
  it('names the per-language labels by the group heading and their language', () => {
    renderPanel({});
    const group = screen.getByRole('group', { name: copy('fields.labelsPerLanguage') });
    expect(within(group).getByRole('textbox', { name: `${copy('fields.labelsPerLanguage')} pl-PL` })).toHaveValue('Usługi');
    expect(within(group).getByRole('textbox', { name: `${copy('fields.labelsPerLanguage')} en-US` })).toHaveValue('');
  });

  it('names an external link’s URL', () => {
    renderPanel({});
    expect(screen.getByRole('textbox', { name: copy('fields.url') })).toHaveValue('https://example.com');
  });

  it('names a button’s link target and variant', () => {
    renderPanel({ kind: 'button', target: { url: '/promotions', variant: 'primary' } });
    expect(screen.getByRole('textbox', { name: copy('fields.linkTarget') })).toHaveValue('/promotions');
    expect(screen.getByRole('combobox', { name: copy('fields.variant') })).toHaveValue('primary');
  });

  it('names an asset’s type', () => {
    renderPanel({ kind: 'asset', target: { assetId: '', kind: 'video' } });
    const types = screen.getAllByRole('combobox', { name: copy('fields.kind') });
    expect(types.map((select) => (select as HTMLSelectElement).value)).toContain('video');
  });

  it('names an embedded block’s side', () => {
    renderPanel({ kind: 'cms-block-embed', target: { blockId: '', embedSide: 'left' } });
    expect(screen.getByRole('combobox', { name: copy('fields.embedSide') })).toHaveValue('left');
  });

  // The pickers' own labels (category, page, asset, block) are #1589's.
  it.each([
    ['external-link', { url: 'https://example.com' }],
    ['button', { url: '/promotions', variant: 'primary' }],
    ['category-tree', { rootCategoryId: null, depth: 2 }],
  ] as const)('leaves no label naming nothing for a %s', (kind, target) => {
    renderPanel({ kind, target } as Partial<IndexedItem>);
    expect(orphanLabels(document.body)).toEqual([]);
  });
});
