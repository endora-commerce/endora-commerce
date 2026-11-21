import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1507 (UX audit 2026-11-17, CAT-05; owner decision DEC-10) — the category tree is a
 * master-detail screen. The tree keeps one row per category with three controls: the name
 * (opens the editor), a ghost "+" (new subcategory) and one actions menu holding the rest,
 * Delete last and destructive. The editor and the create form open in a panel beside the
 * tree, never inside a table cell; opening it moves focus to its heading and closing it
 * returns focus to the control that opened it. Switching away from unsaved changes asks
 * through the kit's `UnsavedChangesDialog` (#1606).
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { CategoriesTree } = await import('../../../../packages/modules/catalog/src/admin/pages/CategoriesTree');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/catalog/i18n/en.json');
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const bundle = { catalog: en, core: coreEn };

function tr(key: string, values: Record<string, string> = {}): string {
  const raw = en[key];
  if (raw === undefined) throw new Error(`missing catalog key ${key}`);
  return raw.replace(/\{(\w+)\}/g, (_m, name: string) => values[name] ?? `{${name}}`);
}

const FURNITURE = '33333333-3333-4333-8333-333333333301';
const LIGHTING = '33333333-3333-4333-8333-333333333302';
const IMAGE = '55555555-5555-4555-8555-555555555501';
const CATEGORIES_URL = '/api/v1/admin/catalog/categories';

function renderTree(): void {
  renderWithSession(
    <MemoryRouter initialEntries={['/catalog/categories']}>
      <CategoriesTree />
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions: [],
      bundle,
    },
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByRole('button', { name }).closest('tr') as HTMLElement;
}

beforeEach(() => {
  getSpy.mockReset().mockResolvedValue({
    data: [
      {
        id: FURNITURE,
        parentCategoryId: null,
        name: { 'en-US': 'Furniture' },
        slug: 'furniture',
        sortOrder: 0,
        isActive: true,
        mainImageAssetId: IMAGE,
      },
      { id: LIGHTING, parentCategoryId: null, name: { 'en-US': 'Lighting' }, slug: 'lighting', sortOrder: 1, isActive: true },
    ],
  });
  postSpy.mockReset().mockResolvedValue({ data: { id: '00000000-0000-4000-8000-00000000c001' } });
  patchSpy.mockReset().mockResolvedValue({ data: {} });
  deleteSpy.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('CategoriesTree — row controls (#1507)', () => {
  it('offers the name, a "+" for a subcategory and one actions menu per row — no button wall', async () => {
    renderTree();
    await screen.findByRole('button', { name: 'Furniture' });
    const row = rowOf('Furniture');
    const buttons = within(row).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Furniture',
      tr('categories.action.newChildOf', { name: 'Furniture' }),
      tr('categories.action.menu', { name: 'Furniture' }),
    ]);
    // Nothing destructive sits on the row itself.
    expect(within(row).queryByRole('button', { name: tr('categories.action.delete') })).toBeNull();
  });

  it('holds Edit, Deactivate and Delete in the menu, Delete last and destructive and confirmed', async () => {
    const user = userEvent.setup();
    renderTree();
    await screen.findByRole('button', { name: 'Furniture' });
    await user.click(screen.getByRole('button', { name: tr('categories.action.menu', { name: 'Furniture' }) }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      tr('categories.action.edit'),
      tr('categories.action.deactivate'),
      tr('categories.action.delete'),
    ]);
    expect(items.at(-1)?.className).toContain('text-destructive');

    await user.click(items.at(-1) as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    expect(deleteSpy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: coreEn['common.action.delete']! }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${CATEGORIES_URL}/${FURNITURE}`));
  });

  it('shows the main image as a 32 px thumbnail, not an id prefix', async () => {
    renderTree();
    await screen.findByRole('button', { name: 'Furniture' });
    const img = rowOf('Furniture').querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain(`/assets/file/${IMAGE}`);
    expect(img?.getAttribute('width')).toBe('32');
    expect(rowOf('Furniture').textContent).not.toContain(IMAGE.slice(0, 8));
  });
});

describe('CategoriesTree — the editor panel (#1507)', () => {
  it('opens the editor beside the tree, not in a table cell, and focuses its heading', async () => {
    renderTree();
    fireEvent.click(await screen.findByRole('button', { name: 'Furniture' }));
    const heading = await screen.findByRole('heading', { name: tr('categories.panel.editTitle', { name: 'Furniture' }) });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const form = screen.getByLabelText(en['categories.field.nameEn']!).closest('form') as HTMLElement;
    expect(form.closest('table')).toBeNull();
    expect(rowOf('Furniture').getAttribute('data-state')).toBe('selected');
    expect(screen.getByRole('button', { name: 'Furniture' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('returns focus to the name that opened it on Cancel', async () => {
    renderTree();
    const name = await screen.findByRole('button', { name: 'Furniture' });
    name.focus();
    fireEvent.click(name);
    const form = (await screen.findByLabelText(en['categories.field.nameEn']!)).closest('form') as HTMLElement;
    fireEvent.click(within(form).getByRole('button', { name: en['categories.action.cancel']! }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Furniture' })));
    expect(screen.queryByLabelText(en['categories.field.nameEn']!)).toBeNull();
  });

  it('"+" opens the create form for a subcategory in the panel, the slug following the name', async () => {
    renderTree();
    await screen.findByRole('button', { name: 'Furniture' });
    fireEvent.click(screen.getByRole('button', { name: tr('categories.action.newChildOf', { name: 'Furniture' }) }));
    expect(
      await screen.findByRole('heading', { name: tr('categories.panel.createChildTitle', { name: 'Furniture' }) }),
    ).toBeTruthy();
    const nameInput = screen.getByLabelText(en['categories.field.nameEn']!);
    expect(nameInput.closest('table')).toBeNull();
    fireEvent.change(nameInput, { target: { value: 'Office chairs' } });
    expect((screen.getByLabelText(en['categories.field.slug']!) as HTMLInputElement).value).toBe('office-chairs');
    fireEvent.click(screen.getByRole('button', { name: en['categories.action.create']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({
      parentCategoryId: FURNITURE,
      slug: 'office-chairs',
      name: { 'en-US': 'Office chairs' },
    });
  });

  it('asks through the kit dialog before another category opens over unsaved changes', async () => {
    renderTree();
    fireEvent.click(await screen.findByRole('button', { name: 'Furniture' }));
    fireEvent.change(await screen.findByLabelText(en['categories.field.nameEn']!), { target: { value: 'Furniture & decor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lighting' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(tr('categories.guard.title', { name: 'Furniture' }))).toBeTruthy();
    fireEvent.click(within(dialog).getByTestId('unsaved-changes-stay'));
    expect((screen.getByLabelText(en['categories.field.nameEn']!) as HTMLInputElement).value).toBe('Furniture & decor');

    // "+" on another row is the same switch.
    fireEvent.click(screen.getByRole('button', { name: tr('categories.action.newChildOf', { name: 'Lighting' }) }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('unsaved-changes-discard'));
    expect(
      await screen.findByRole('heading', { name: tr('categories.panel.createChildTitle', { name: 'Lighting' }) }),
    ).toBeTruthy();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('has no axe violations with the editor open', async () => {
    renderTree();
    fireEvent.click(await screen.findByRole('button', { name: 'Furniture' }));
    await screen.findByLabelText(en['categories.field.nameEn']!);
    await expectNoAxeViolations(document.body);
  });
});
