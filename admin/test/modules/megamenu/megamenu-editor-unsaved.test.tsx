import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import type { MegamenuDetail } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { megamenuClient } from '../../../../packages/modules/megamenu/src/admin/api/megamenu-client';
import { MegamenuEditor } from '../../../../packages/modules/megamenu/src/admin/pages/MegamenuEditor';

/**
 * Issue #1461 (UX audit CONTENT-02) — the megamenu editor says when it holds
 * unsaved changes (one hint beside the one header Save since issue #1512), and a
 * link out of the editor asks Save / Discard / Stay. A binding saved on its own
 * no longer reloads the stored tree over an unsaved one.
 */
function bundleOf(pkg: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(__dirname, `../../../../packages/modules/${pkg}/i18n/en.json`), 'utf8')) as Record<
    string,
    string
  >;
}
const en = bundleOf('megamenu');
const core = bundleOf('_i18n');

/** The shipped `core` copy of the unsaved-changes guard (issue #1461). */
function ux(key: string): string {
  const value = core[`form.unsavedChanges.${key}`];
  if (!value) throw new Error(`_i18n/i18n/en.json carries no "form.unsavedChanges.${key}"`);
  return value;
}

const stored = {
  id: 'menu-1',
  name: 'Main menu',
  description: null,
  version: 3,
  bindings: [],
  items: [
    { id: 'item-1', parentId: null, position: 0, kind: 'external-link', labels: { 'en-US': 'Shop' }, target: { url: 'https://example.com' }, presentation: 'link', alignment: 'start' },
  ],
} as unknown as MegamenuDetail;

function renderEditor(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/megamenu/menu-1']}>
      <Routes>
        <Route path="/megamenu/:id" element={<MegamenuEditor />} />
        <Route path="/megamenu" element={<p>Menu list</p>} />
      </Routes>
    </MemoryRouter>,
    { megamenu: en, core },
  );
}

const hints = (): string[] => screen.getAllByTestId('unsaved-changes-hint').map((hint) => hint.textContent ?? '');

beforeEach(() => {
  vi.spyOn(megamenuClient, 'getMenu').mockResolvedValue(stored);
  vi.spyOn(apiClient, 'get').mockResolvedValue({ items: [], data: [] } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MegamenuEditor — unsaved changes', () => {
  it('is clean as loaded and a link out leaves at once', async () => {
    renderEditor();
    await screen.findByRole('heading', { level: 1, name: 'Main menu' });
    expect(hints()).toEqual(['']);
    fireEvent.click(screen.getByRole('link', { name: en['common.back'] ?? 'Back' }));
    expect(await screen.findByText('Menu list')).toBeTruthy();
  });

  it('marks the editor unsaved, and Back asks before leaving it', async () => {
    renderEditor();
    await screen.findByRole('heading', { level: 1, name: 'Main menu' });
    fireEvent.change(screen.getByDisplayValue('Main menu'), { target: { value: 'Top menu' } });
    expect(hints()).toEqual([ux('hint')]);
    fireEvent.click(screen.getByRole('link', { name: en['common.back'] ?? 'Back' }));
    const dialog = screen.getByRole('dialog', { name: ux('title') });
    fireEvent.click(within(dialog).getByRole('button', { name: ux('stay') }));
    expect(screen.queryByText('Menu list')).toBeNull();
    expect(screen.getByDisplayValue('Top menu')).toBeTruthy();
  });

  it('Save and continue saves what changed on the loaded version, then leaves', async () => {
    const patch = vi.spyOn(megamenuClient, 'patchMenu').mockResolvedValue({ ...stored, name: 'Top menu', version: 4 });
    renderEditor();
    await screen.findByRole('heading', { level: 1, name: 'Main menu' });
    fireEvent.change(screen.getByDisplayValue('Main menu'), { target: { value: 'Top menu' } });
    fireEvent.click(screen.getByRole('link', { name: en['common.back'] ?? 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: ux('save') }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('menu-1', { name: 'Top menu', description: null, version: 3 }));
    expect(await screen.findByText('Menu list')).toBeTruthy();
  });
});
