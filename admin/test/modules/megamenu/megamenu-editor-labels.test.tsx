import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1465 (UX audit CONTENT-07): the menu's Name and Description are named
 * by the labels above them, not left as anonymous fields.
 */
const MENU = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Main menu',
  description: 'Header navigation',
  version: 1,
  bindings: [],
  activeIn: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  items: [],
};

vi.mock('../../../../packages/modules/megamenu/src/admin/api/megamenu-client', () => ({
  megamenuClient: { getMenu: vi.fn(async () => MENU) },
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(async () => ({ items: [] })) } };
});

const { MegamenuEditor } = await import('../../../../packages/modules/megamenu/src/admin/pages/MegamenuEditor');

const en = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../packages/modules/megamenu/i18n/en.json'), 'utf8'),
) as Record<string, string>;

describe('MegamenuEditor — metadata fields named by their labels (#1465)', () => {
  it('names Name and Description', async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={[`/megamenus/${MENU.id}`]}>
        <Routes>
          <Route path="/megamenus/:id" element={<MegamenuEditor />} />
        </Routes>
      </MemoryRouter>,
      { megamenu: en },
    );
    expect(await screen.findByRole('textbox', { name: en['fields.name']! })).toHaveValue('Main menu');
    expect(screen.getByRole('textbox', { name: en['fields.description']! })).toHaveValue('Header navigation');
  });
});
