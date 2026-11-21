import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * Feature 180, WP-6 — the category editor's Save includes its price display mode
 * (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §1; US8, US5;
 * FR-050…FR-052, FR-030, FR-034).
 *
 * The participant is the real one: `price_lists`' `DisplayModeOverrideRow`, contributed to
 * `category.editor.after` through the package's own `contributions`. Every write the screen
 * sends lands in one ordered log, so "the category write first, then the display mode" is the
 * order of that log.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();
const putSpy = vi.fn();
const writes: string[] = [];

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => {
        writes.push(`PUT ${String(args[0])}`);
        return putSpy(...args);
      },
      patch: (...args: unknown[]) => {
        writes.push(`PATCH ${String(args[0])}`);
        return patchSpy(...args);
      },
      delete: vi.fn(),
    },
  };
});

const { CategoriesTree } = await import('../../../../packages/modules/catalog/src/admin/pages/CategoriesTree');
const priceLists = await import('@endora-commerce/mod-price-lists/admin');
const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
);

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/catalog/i18n/en.json');
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const priceListsEn = read('../packages/modules/price_lists/i18n/en.json');
const bundle = { catalog: en, core: coreEn, price_lists: priceListsEn };

const FURNITURE = '33333333-3333-4333-8333-333333333301';
const LIGHTING = '33333333-3333-4333-8333-333333333302';
const CATEGORIES_URL = '/api/v1/admin/catalog/categories';
const modeUrl = (id: string): string => `/api/v1/admin/pricing/display-mode-overrides/category/${id}`;
const MODE_LABEL = coreEn['priceLists.displayMode.rowLabel']!;

function renderTree(options: { present?: boolean; permissions?: readonly string[] } = {}): void {
  const modules = everyDeclaredModule();
  renderWithSession(
    <MemoryRouter initialEntries={['/catalog/categories']}>
      <CategoriesTree />
    </MemoryRouter>,
    {
      session: adminSession({
        permissions: options.permissions ?? ['catalog:read', 'catalog:write', 'price_lists:read', 'price_lists:write'],
      }),
      presence:
        options.present === false
          ? modulePresence({ present: modules, absent: ['price_lists'] })
          : modulePresence({ present: modules }),
      contributions: [{ moduleId: 'price_lists', contributions: priceLists.contributions }],
      bundle,
    },
  );
}

/** The edit form of the open category. */
function form(): HTMLElement {
  return screen.getByLabelText(en['categories.field.nameEn']!).closest('form') as HTMLElement;
}

/** The row's name opens the category in the editor panel (#1507). */
async function openEdit(rowName = 'Furniture'): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: rowName }));
  await screen.findByLabelText(MODE_LABEL);
}

async function chooseMode(mode: string): Promise<void> {
  const select = (await screen.findByLabelText(MODE_LABEL)) as HTMLSelectElement;
  await waitFor(() => expect(select.disabled).toBe(false));
  fireEvent.change(select, { target: { value: mode } });
}

function saveButton(): HTMLElement {
  return within(form()).getByRole('button', { name: /^Save/ });
}

/** The stored categories: a `PATCH` changes them, so the next read answers what was saved. */
let stored: Record<string, unknown>[] = [];

beforeEach(() => {
  writes.length = 0;
  stored = [
    { id: FURNITURE, parentCategoryId: null, name: { 'en-US': 'Furniture' }, slug: 'furniture', sortOrder: 0, isActive: true },
    { id: LIGHTING, parentCategoryId: null, name: { 'en-US': 'Lighting' }, slug: 'lighting', sortOrder: 1, isActive: true },
  ];
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url === CATEGORIES_URL) return { data: stored.map((row) => ({ ...row })) };
    if (url.startsWith('/api/v1/admin/pricing/display-mode-overrides/category/')) return { data: { mode: 'gross_only' } };
    throw new Error(`unexpected request: ${url}`);
  });
  patchSpy.mockReset().mockImplementation(async (url: string, body: Record<string, unknown>) => {
    const id = url.slice(`${CATEGORIES_URL}/`.length);
    stored = stored.map((row) => (row['id'] === id ? { ...row, ...body } : row));
    return { data: stored.find((row) => row['id'] === id) };
  });
  putSpy.mockReset().mockResolvedValue({ data: { mode: 'net_only' } });
});
afterEach(() => cleanup());

describe('category editor — one Save covers the display mode (feature 180, WP-6)', () => {
  it('mounts the display-mode row above the Save row', async () => {
    renderTree();
    await openEdit();
    const select = screen.getByLabelText(MODE_LABEL);
    // The row precedes Save in document order: what Save covers sits above it (FR-052).
    expect(select.compareDocumentPosition(saveButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not write the display mode on change; Save counts it', async () => {
    renderTree();
    await openEdit();
    await chooseMode('net_only');
    expect(putSpy).not.toHaveBeenCalled();
    expect(saveButton()).toHaveTextContent('Save 1 change');
    expect(screen.queryByText(coreEn['priceLists.displayMode.savedSuffix']!)).toBeNull();
  });

  it('writes the category first, then the display mode', async () => {
    renderTree();
    await openEdit();
    fireEvent.change(screen.getByLabelText(en['categories.field.nameEn']!), { target: { value: 'Furniture & decor' } });
    await chooseMode('net_only');
    expect(saveButton()).toHaveTextContent('Save 2 changes');
    fireEvent.click(saveButton());

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(writes).toEqual([`PATCH ${CATEGORIES_URL}/${FURNITURE}`, `PUT ${modeUrl(FURNITURE)}`]);
    expect(patchSpy.mock.calls[0]?.[1]).toMatchObject({ name: { 'en-US': 'Furniture & decor' } });
    expect(putSpy.mock.calls[0]?.[1]).toEqual({ mode: 'net_only' });
    // Everything saved: the editor closes, as it does after a category save today.
    await waitFor(() => expect(screen.queryByLabelText(MODE_LABEL)).toBeNull());
  });

  it('writes only the display mode when only it changed', async () => {
    renderTree();
    await openEdit();
    await chooseMode('both');
    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('does not write the display mode when the category write is refused', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'CATEGORY_SLUG_TAKEN', message: 'That slug is already used.', requestId: 'r' } } as never),
    );
    renderTree();
    await openEdit();
    fireEvent.change(screen.getByLabelText(en['categories.field.slug']!), { target: { value: 'lighting' } });
    await chooseMode('net_only');
    fireEvent.click(saveButton());

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('That slug is already used.')).toBeInTheDocument();
    expect(putSpy).not.toHaveBeenCalled();
    // Both changes are still staged.
    expect(saveButton()).toHaveTextContent('Save 2 changes');
  });

  it('keeps the category saved when the display-mode write fails, and retries only the mode', async () => {
    putSpy.mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'The server failed.', requestId: 'r' } } as never),
    );
    renderTree();
    await openEdit();
    fireEvent.change(screen.getByLabelText(en['categories.field.nameEn']!), { target: { value: 'Furniture & decor' } });
    await chooseMode('net_only');
    fireEvent.click(saveButton());

    expect(await screen.findByText(coreEn['saveSession.summary.partial']!)).toBeInTheDocument();
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(saveButton()).toHaveTextContent('Save 1 change');

    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it('Cancel discards the display-mode change without asking', async () => {
    renderTree();
    await openEdit();
    await chooseMode('net_only');
    fireEvent.click(within(form()).getByRole('button', { name: en['categories.action.cancel']! }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await openEdit();
    await waitFor(() => expect((screen.getByLabelText(MODE_LABEL) as HTMLSelectElement).value).toBe('gross_only'));
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('asks Save / Discard / Stay (the kit dialog, #1606) before another category opens over a display-mode change', async () => {
    renderTree();
    await openEdit();
    await chooseMode('net_only');
    const lighting = screen.getByRole('button', { name: 'Lighting' });
    fireEvent.click(lighting);

    const dialog = await screen.findByRole('dialog');
    // Stay: nothing changes.
    fireEvent.click(within(dialog).getByTestId('unsaved-changes-stay'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText(en['categories.field.slug']!) as HTMLInputElement).value).toBe('furniture');
    expect(saveButton()).toHaveTextContent('Save 1 change');

    // Discard: the other category opens and nothing was written.
    fireEvent.click(lighting);
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('unsaved-changes-discard'));
    await waitFor(() => expect((screen.getByLabelText(en['categories.field.slug']!) as HTMLInputElement).value).toBe('lighting'));
    expect(putSpy).not.toHaveBeenCalled();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('Save in the guard writes the change, then opens the other category', async () => {
    renderTree();
    await openEdit();
    await chooseMode('net_only');
    const lighting = screen.getByRole('button', { name: 'Lighting' });
    fireEvent.click(lighting);
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('unsaved-changes-save'));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0]?.[0]).toBe(modeUrl(FURNITURE));
    await waitFor(() => expect((screen.getByLabelText(en['categories.field.slug']!) as HTMLInputElement).value).toBe('lighting'));
  });

  it('asks the browser before the tab closes over a display-mode change', async () => {
    renderTree();
    await openEdit();
    await chooseMode('net_only');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('category editor — price_lists not installed (feature 180, US5)', () => {
  it('shows no display-mode row and sends no pricing request', async () => {
    renderTree({ present: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Furniture' }));
    await screen.findByLabelText(en['categories.field.nameEn']!);
    expect(screen.queryByLabelText(MODE_LABEL)).toBeNull();
    expect(getSpy.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/pricing/'))).toEqual([]);
    expect(saveButton()).toHaveTextContent(/^Save$/);
  });
});
