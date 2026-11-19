import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { answerConfirm } from '../../helpers/confirm-dialog';

/**
 * Issue #1495 (UX audit CONTENT-13) — the megamenu list: no card titled with
 * the page's own title, no create form drawn open in the header (a "New
 * megamenu" that opens a dialog), statuses as badges with text, and a row
 * action menu with a confirmed delete through the module's own endpoint.
 */

const client = vi.hoisted(() => ({ listMenus: vi.fn(), createMenu: vi.fn(), deleteMenu: vi.fn() }));
vi.mock('../../../../packages/modules/megamenu/src/admin/api/megamenu-client', () => ({ megamenuClient: client }));

const { MegamenuListPage } = await import('../../../../packages/modules/megamenu/src/admin/pages/MegamenuListPage');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/megamenu/i18n/en.json');
const pl = read('../packages/modules/megamenu/i18n/pl.json');
const core = read('../packages/modules/_i18n/i18n/en.json');

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

const MENU_ID = '00000000-0000-4000-8000-0000000000f1';
const menu = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: MENU_ID,
  name: 'Main navigation',
  description: null,
  version: 3,
  bindings: [],
  activeIn: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

function mount(permissions: string[] = ['*']): void {
  renderWithSession(
    <MemoryRouter initialEntries={['/megamenu']}>
      <Routes>
        <Route path="/megamenu" element={<MegamenuListPage />} />
        <Route path="/megamenu/:id" element={<p>editor</p>} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions }),
      presence: modulePresence({ present: ['megamenu'] }),
      bundle: { megamenu: en, core },
    },
  );
}

async function openRowMenu(name: string): Promise<void> {
  const trigger = await screen.findByRole('button', { name: fill(en['listActions.label']!, { name }) });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.listMenus.mockResolvedValue({ data: [menu(), menu({ id: '00000000-0000-4000-8000-0000000000f2', name: 'Footer', activeIn: 2 })] });
  client.deleteMenu.mockResolvedValue(undefined);
  client.createMenu.mockResolvedValue(menu({ id: '00000000-0000-4000-8000-0000000000f3', name: 'New one' }));
});

describe('megamenu list', () => {
  it('ships its keys in English and Polish, and retires the card title', () => {
    const keys = Object.keys(en).filter((key) => /^(list|listActions)\./.test(key));
    for (const key of keys) expect(pl[key], key).toBeTruthy();
    expect(en['list.cardTitle']).toBeUndefined();
    expect(pl['list.cardTitle']).toBeUndefined();
  });

  it('has one heading and draws no create form above the list', async () => {
    mount();
    await screen.findByText('Main navigation');
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('draws "active in n scopes" and "staged" as badges with text', async () => {
    mount();
    expect(await screen.findByText(fill(en['list.activeScopes']!, { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(en['state.staged']!)).toBeInTheDocument();
  });

  it('creates a megamenu from a dialog and opens it', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: en['list.new']! }));
    const dialog = await screen.findByRole('dialog', { name: en['list.new']! });
    await userEvent.type(within(dialog).getByRole('textbox', { name: en['list.nameLabel']! }), 'New one');
    await userEvent.click(within(dialog).getByRole('button', { name: en['common.create']! }));
    await waitFor(() => expect(client.createMenu).toHaveBeenCalledWith({ name: 'New one' }));
    expect(await screen.findByText('editor')).toBeInTheDocument();
  });

  it('deletes a megamenu through the confirmation', async () => {
    mount();
    await openRowMenu('Main navigation');
    expect((await screen.findByRole('menuitem', { name: en['listActions.open']! })).getAttribute('href')).toBe(
      `/megamenu/${MENU_ID}`,
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    await answerConfirm(true);
    await waitFor(() => expect(client.deleteMenu).toHaveBeenCalledWith(MENU_ID));
    expect(await screen.findByText(fill(en['list.deleted']!, { name: 'Main navigation' }))).toBeInTheDocument();
  });

  it('says why a megamenu still bound to a channel cannot go', async () => {
    client.deleteMenu.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'MEGAMENU_HAS_ACTIVE_BINDINGS', message: 'x' } } as never),
    );
    mount();
    await openRowMenu('Footer');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    await answerConfirm(true);
    expect(await within(await screen.findByRole('dialog')).findByText(en['listActions.deleteActiveBindings']!)).toBeInTheDocument();
  });

  it('offers neither create nor row actions without megamenu.write', async () => {
    mount(['megamenu.read']);
    await screen.findByText('Main navigation');
    expect(screen.queryByRole('button', { name: en['list.new']! })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fill(en['listActions.label']!, { name: 'Footer' }) })).not.toBeInTheDocument();
  });
});
