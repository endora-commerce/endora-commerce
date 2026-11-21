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
 * Issue #1512 (UX audit 2026-11-17, CONTENT-09; owner decision DEC-08) — the megamenu editor
 * had two filled save buttons, "Save metadata" and "Save tree", the item panel in a third column
 * saved by the tree's button, and bindings that applied at once with nothing saying so. Now: one
 * Save in the header covers the name, the description, the tree and the item being edited; the
 * Bindings section, which still applies at once, carries the kit's `ImmediateBadge`, and a
 * binding's result is an `InlineStatus` in that section. No binding row offers a filled button.
 *
 * Issue #1534 (CONTENT-16) — no fixed 12-column grid: the columns start at `lg`, stacking below
 * it, the item panel sits beside the tree it edits, and the bindings table gets a row of its own
 * width rather than a third of the page.
 */
function bundleOf(pkg: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(__dirname, `../../../../packages/modules/${pkg}/i18n/en.json`), 'utf8')) as Record<
    string,
    string
  >;
}
const en = bundleOf('megamenu');
const core = bundleOf('_i18n');
const IMMEDIATE = core['saveSession.immediateBadge']!;

function copy(key: string, params: Record<string, string> = {}): string {
  const value = en[key];
  if (!value) throw new Error(`megamenu/i18n/en.json carries no "${key}"`);
  return Object.entries(params).reduce((text, [k, v]) => text.replace(`{${k}}`, v), value);
}

const stored = {
  id: 'menu-1',
  name: 'Main menu',
  description: null,
  version: 3,
  bindings: [{ salesChannelId: 'channel-1', language: 'en-US', active: false }],
  items: [
    {
      id: 'item-1',
      parentId: null,
      position: 0,
      kind: 'external-link',
      labels: { 'en-US': 'Shop' },
      target: { url: 'https://example.com' },
      presentation: 'link',
      alignment: 'start',
    },
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

async function loaded(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Main menu' });
}

function sectionHeading(key: string): HTMLElement {
  const title = copy(key);
  const found = screen.getAllByRole('heading', { level: 2 }).find((h) => (h.textContent ?? '').startsWith(title));
  if (!found) throw new Error(`no section heading starts with "${title}"`);
  return found;
}

function section(key: string): HTMLElement {
  return sectionHeading(key).closest('[data-slot="card"]') as HTMLElement;
}

beforeEach(() => {
  vi.spyOn(megamenuClient, 'getMenu').mockResolvedValue(stored);
  vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels?')) {
      return Promise.resolve({ items: [{ id: 'channel-1', code: 'web' }] } as never);
    }
    return Promise.resolve({ items: [], data: [] } as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MegamenuEditor — one Save in the header (#1512, DEC-08)', () => {
  it('offers one Save, in the header, and no per-card save buttons', async () => {
    renderEditor();
    await loaded();

    const saves = screen.getAllByRole('button', { name: copy('common.save') });
    expect(saves).toHaveLength(1);
    expect(saves[0]!.closest('[data-save-actions]')).not.toBeNull();
    expect(saves[0]!.closest('[data-slot="card"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save metadata|Save tree/ })).toBeNull();
  });

  it('saves the name and the tree with that one Save, the tree on the version the name answered with', async () => {
    const patch = vi.spyOn(megamenuClient, 'patchMenu').mockResolvedValue({ ...stored, name: 'Top menu', version: 4 });
    const putItems = vi
      .spyOn(megamenuClient, 'putItems')
      .mockResolvedValue({ data: { ...stored, name: 'Top menu', version: 5 } } as never);
    renderEditor();
    await loaded();

    fireEvent.change(screen.getByDisplayValue('Main menu'), { target: { value: 'Top menu' } });
    fireEvent.click(screen.getByRole('button', { name: copy('tree.addTopLevel') }));
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => expect(putItems).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('menu-1', { name: 'Top menu', description: null, version: 3 });
    expect((putItems.mock.calls[0]![1] as { version: number }).version).toBe(4);
  });

  it('saves only what changed: an untouched tree is not rewritten', async () => {
    const patch = vi.spyOn(megamenuClient, 'patchMenu').mockResolvedValue({ ...stored, name: 'Top menu', version: 4 });
    const putItems = vi.spyOn(megamenuClient, 'putItems');
    renderEditor();
    await loaded();

    fireEvent.change(screen.getByDisplayValue('Main menu'), { target: { value: 'Top menu' } });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(putItems).not.toHaveBeenCalled();
  });

  it('says the result beside the Save, in a live region mounted before it', async () => {
    vi.spyOn(megamenuClient, 'patchMenu').mockResolvedValue({ ...stored, name: 'Top menu', version: 4 });
    renderEditor();
    await loaded();
    const group = screen.getByRole('button', { name: copy('common.save') }).closest('[data-save-actions]') as HTMLElement;
    const status = within(group).getByRole('status');
    expect(status.textContent).toBe('');

    fireEvent.change(screen.getByDisplayValue('Main menu'), { target: { value: 'Top menu' } });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => expect(status.textContent).toContain(copy('editor.saved')));
  });

  it('has one unsaved-changes hint, beside the Save', async () => {
    renderEditor();
    await loaded();
    const hints = screen.getAllByTestId('unsaved-changes-hint');
    expect(hints).toHaveLength(1);
    expect(hints[0]!.closest('[data-save-actions]')).not.toBeNull();
  });
});

describe('MegamenuEditor — bindings apply at once, and say so (#1512, DEC-08)', () => {
  it('puts the Immediate badge on the Bindings heading and on no other section', async () => {
    renderEditor();
    await loaded();

    expect(sectionHeading('sections.bindings').textContent).toContain(IMMEDIATE);
    for (const key of ['sections.metadata', 'sections.items', 'sections.item']) {
      expect(sectionHeading(key).textContent, key).not.toContain(IMMEDIATE);
    }
  });

  it('offers no filled button in the bindings section: the header Save is the one primary', async () => {
    renderEditor();
    await loaded();
    const bindings = section('sections.bindings');
    await within(bindings).findByRole('button', { name: copy('bindings.activate') });

    const filled = within(bindings)
      .getAllByRole('button')
      .filter((button) => /(^|\s)bg-primary(\s|$)/.test(button.className));
    expect(filled.map((button) => button.textContent)).toEqual([]);
  });

  it('names the remove button by the binding it removes', async () => {
    renderEditor();
    await loaded();
    const bindings = section('sections.bindings');
    expect(
      await within(bindings).findByRole('button', { name: copy('bindings.remove', { channel: 'web', language: 'en-US' }) }),
    ).toBeTruthy();
  });

  it('says an activation beside the bindings, not as a banner', async () => {
    vi.spyOn(megamenuClient, 'activate').mockResolvedValue({ previouslyActive: null } as never);
    renderEditor();
    await loaded();
    const bindings = section('sections.bindings');
    const status = within(bindings).getByRole('status');
    expect(status.textContent).toBe('');

    fireEvent.click(await within(bindings).findByRole('button', { name: copy('bindings.activate') }));

    await waitFor(() => expect(status.textContent).toContain(copy('bindings.activated')));
  });
});

describe('MegamenuEditor — reflows below lg (#1534, CONTENT-16)', () => {
  it('uses no fixed 12-column grid: every grid and span starts at a breakpoint', async () => {
    renderEditor();
    await loaded();
    // Select the item, so the item panel's own rows are rendered too.
    fireEvent.click(screen.getByText('Shop').closest('button')!);

    const classes = [...document.body.querySelectorAll('[class]')].map((element) => element.getAttribute('class') ?? '');
    const bare = classes.filter((names) => names.split(/\s+/).some((name) => /^(grid-cols-12|col-span-\d+)$/.test(name)));
    expect(bare).toEqual([]);
  });

  it('puts the item panel beside the tree, and the bindings in a row of their own', async () => {
    renderEditor();
    await loaded();

    const items = section('sections.items');
    const item = section('sections.item');
    const bindings = section('sections.bindings');
    expect(items.parentElement?.parentElement).toBe(item.parentElement?.parentElement);
    expect(bindings.parentElement?.parentElement).not.toBe(items.parentElement?.parentElement);
  });
});
