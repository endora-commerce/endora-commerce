import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { answerConfirm } from '../../helpers/confirm-dialog';

/**
 * Issue #1495 (UX audit CONTENT-13) — the CMS page, block, template and hook
 * lists: no card titled with the page's own title, statuses as badges with
 * text, a row action menu that opens and deletes (through the confirmation
 * dialog and the module's own delete endpoint), the kit empty states, and a
 * search that runs as the operator types. DEC-17 adds Duplicate to the page,
 * block and template menus: it runs at once and opens the copy's editor.
 */

const client = vi.hoisted(() => ({
  listPages: vi.fn(),
  deletePage: vi.fn(),
  listBlocks: vi.fn(),
  deleteBlock: vi.fn(),
  listTemplates: vi.fn(),
  deleteTemplate: vi.fn(),
  listHooks: vi.fn(),
  deleteHook: vi.fn(),
  duplicatePage: vi.fn(),
  duplicateBlock: vi.fn(),
  duplicateTemplate: vi.fn(),
}));

vi.mock('../../../../packages/modules/cms/src/admin/api/cms-client', () => ({ cmsClient: client }));
// The hooks screen's side panel reads attachments of its own; it is not under test here.
vi.mock('../../../../packages/modules/cms/src/admin/components/HookBlockAttachmentsPanel', () => ({
  HookBlockAttachmentsPanel: () => null,
}));

const { PagesListPage } = await import('../../../../packages/modules/cms/src/admin/pages/PagesListPage');
const { BlocksListPage } = await import('../../../../packages/modules/cms/src/admin/pages/BlocksListPage');
const { TemplatesListPage } = await import('../../../../packages/modules/cms/src/admin/pages/TemplatesListPage');
const { HooksPage } = await import('../../../../packages/modules/cms/src/admin/pages/HooksPage');
const { useDuplicatedLanding, DUPLICATED_STATE } = await import(
  '../../../../packages/modules/cms/src/admin/components/duplicate-record'
);

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/cms/i18n/en.json');
const pl = read('../packages/modules/cms/i18n/pl.json');
const core = read('../packages/modules/_i18n/i18n/en.json');

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

const ABOUT = '00000000-0000-4000-8000-000000000003';
const page = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ABOUT,
  name: 'About',
  slug: 'o-nas',
  status: 'published',
  active: true,
  description: null,
  salesChannelIds: [],
  languages: ['pl-PL'],
  version: 1,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  parentPageId: null,
  parentPathInUrl: false,
  translations: {},
  ...over,
});
const block = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '00000000-0000-4000-8000-0000000000b1',
  name: 'Footer promo',
  code: 'footer-promo',
  active: true,
  languages: ['pl-PL'],
  ...over,
});
const template = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Landing',
  code: 'landing',
  languages: ['pl-PL'],
  ...over,
});
const hook = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  name: 'Home top',
  code: 'home-top',
  active: true,
  isSystem: false,
  salesChannelIds: [],
  attachmentCount: 0,
  ...over,
});

function mount(element: ReactElement, permissions: string[] = ['*']): void {
  renderWithSession(<MemoryRouter>{element}</MemoryRouter>, {
    session: adminSession({ permissions }),
    presence: modulePresence({ present: ['cms'] }),
    bundle: { cms: en, core },
  });
}

async function openRowMenu(name: string): Promise<void> {
  const trigger = await screen.findByRole('button', { name: fill(en['listActions.label']!, { name }) });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.listPages.mockResolvedValue({ data: [page()], nextCursor: null });
  client.listBlocks.mockResolvedValue({ data: [block()] });
  client.listTemplates.mockResolvedValue({ data: [template()] });
  client.listHooks.mockResolvedValue({
    data: [hook(), hook({ id: '00000000-0000-4000-8000-0000000000d2', name: 'Checkout', code: 'checkout', isSystem: true })],
  });
  client.deletePage.mockResolvedValue(undefined);
  client.deleteBlock.mockResolvedValue(undefined);
  client.deleteTemplate.mockResolvedValue(undefined);
  client.deleteHook.mockResolvedValue(undefined);
});

describe('CMS lists — copy', () => {
  it('ships every new key in English and Polish, and retires the card titles', () => {
    const keys = Object.keys(en).filter((key) =>
      /^(listActions|pagesList|blocksList|templatesList|hooksList)\./.test(key),
    );
    for (const key of keys) expect(pl[key], key).toBeTruthy();
    for (const list of ['pagesList', 'blocksList', 'templatesList', 'hooksList']) {
      expect(en[`${list}.cardTitle`], list).toBeUndefined();
      expect(pl[`${list}.cardTitle`], list).toBeUndefined();
    }
  });
});

describe.each([
  ['pages', <PagesListPage key="p" />, 'pagesList', 'About', client.deletePage, ABOUT],
  ['blocks', <BlocksListPage key="b" />, 'blocksList', 'Footer promo', client.deleteBlock, '00000000-0000-4000-8000-0000000000b1'],
  ['templates', <TemplatesListPage key="t" />, 'templatesList', 'Landing', client.deleteTemplate, '00000000-0000-4000-8000-0000000000c1'],
] as const)('CMS %s list', (_label, element, list, name, remove, id) => {
  it('has one heading — the page title — and no card repeating it', async () => {
    mount(element);
    await screen.findByText(name);
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]!.textContent).toBe(en[`${list}.title`]);
  });

  it('opens the record from the row menu and deletes it through the confirmation', async () => {
    mount(element);
    await openRowMenu(name);
    const open = await screen.findByRole('menuitem', { name: en['listActions.open']! });
    expect(open.getAttribute('href')).toContain(id);
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    expect(
      within(await screen.findByRole('dialog')).getByText(fill(en[`${list}.deleteConfirm`]!, { name })),
    ).toBeInTheDocument();
    await answerConfirm(true);
    await waitFor(() => expect(remove).toHaveBeenCalledWith(id));
    expect(await screen.findByText(fill(en[`${list}.deleted`]!, { name }))).toBeInTheDocument();
  });

  it('keeps the dialog open and says why when the record is still referenced', async () => {
    remove.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'CMS_REFERENCED', message: 'CMS object is referenced.' } } as never),
    );
    mount(element);
    await openRowMenu(name);
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    await answerConfirm(true);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(en['listActions.deleteReferenced']!)).toBeInTheDocument();
  });

  it('offers no row actions without cms.write', async () => {
    mount(element, ['cms.read']);
    await screen.findByText(name);
    expect(screen.queryByRole('button', { name: fill(en['listActions.label']!, { name }) })).not.toBeInTheDocument();
  });

  it('shows the kit empty state, with the create action, when there is nothing yet', async () => {
    client.listPages.mockResolvedValue({ data: [], nextCursor: null });
    client.listBlocks.mockResolvedValue({ data: [] });
    client.listTemplates.mockResolvedValue({ data: [] });
    mount(element);
    expect(await screen.findByText(en[`${list}.emptyTitle`]!)).toBeInTheDocument();
    // One "New …": the empty state's; the header's would compete with it.
    expect(screen.getAllByRole('link', { name: en[`${list}.new`]! })).toHaveLength(1);
  });
});

describe('CMS lists — focus after a delete (WCAG 2.4.3)', () => {
  it('moves focus to the next row once a row is deleted', async () => {
    client.listBlocks.mockResolvedValue({
      data: [block(), block({ id: '00000000-0000-4000-8000-0000000000b2', name: 'Header promo', code: 'header-promo' })],
    });
    mount(<BlocksListPage />);
    await openRowMenu('Footer promo');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    await answerConfirm(true);
    await waitFor(() => expect(screen.queryByText('Footer promo')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Header promo' })));
  });

  it('moves focus to the create action once the last row is deleted', async () => {
    mount(<PagesListPage />);
    await openRowMenu('About');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    await answerConfirm(true);
    const create = await screen.findByRole('link', { name: en['pagesList.new']! });
    await waitFor(() => expect(document.activeElement).toBe(create));
  });
});

describe('CMS pages list — statuses and search', () => {
  it('draws the status and the inactive state as badges with text', async () => {
    client.listPages.mockResolvedValue({ data: [page({ status: 'draft', active: false })], nextCursor: null });
    mount(<PagesListPage />);
    expect(await screen.findByText(en['status.draft']!)).toBeInTheDocument();
    expect(screen.getByText(en['state.inactive']!)).toBeInTheDocument();
  });

  it('searches as the operator types, without Enter or a Search button', async () => {
    mount(<PagesListPage />);
    const search = await screen.findByRole('searchbox', { name: en['pagesList.searchLabel']! });
    expect(screen.queryByRole('button', { name: /^search$/i })).not.toBeInTheDocument();
    await userEvent.type(search, 'about');
    await waitFor(() => expect(client.listPages).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'about' })));
  });

  it('filters by status', async () => {
    mount(<PagesListPage />);
    const status = await screen.findByRole('combobox', { name: en['pagesList.statusFilter']! });
    await userEvent.selectOptions(status, 'archived');
    await waitFor(() =>
      expect(client.listPages).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'archived' })),
    );
  });

  it('tells "nothing matches" apart from "nothing yet"', async () => {
    mount(<PagesListPage />);
    await screen.findByText('About');
    client.listPages.mockResolvedValue({ data: [], nextCursor: null });
    await userEvent.type(screen.getByRole('searchbox', { name: en['pagesList.searchLabel']! }), 'zzz');
    expect(await screen.findByText(core['common.emptyState.noResults.title']!)).toBeInTheDocument();
    expect(screen.queryByText(en['pagesList.emptyTitle']!)).not.toBeInTheDocument();
  });
});

describe('CMS hooks', () => {
  it('has one heading and offers delete only for a custom hook', async () => {
    mount(<HooksPage />);
    await screen.findByText('Home top');
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: fill(en['listActions.label']!, { name: 'Checkout' }) })).not.toBeInTheDocument();
    await openRowMenu('Home top');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    await answerConfirm(true);
    await waitFor(() => expect(client.deleteHook).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000d1'));
  });

  it('draws active and system/custom as badges with text', async () => {
    mount(<HooksPage />);
    await screen.findByText('Home top');
    expect(screen.getAllByText(en['state.active']!).length).toBeGreaterThan(0);
    expect(screen.getByText(en['state.system']!)).toBeInTheDocument();
    expect(screen.getByText(en['state.custom']!)).toBeInTheDocument();
  });
});

/** Where a Duplicate lands: the editor route, which here only reports the path and the state. */
function EditorProbe(): ReactNode {
  const location = useLocation();
  return (
    <p data-testid="editor-probe">
      {location.pathname} {JSON.stringify(location.state)}
    </p>
  );
}

function mountRouted(element: ReactElement): void {
  renderWithSession(
    <MemoryRouter initialEntries={['/list']}>
      <Routes>
        <Route path="/list" element={element} />
        <Route path="/cms/:kind/:id" element={<EditorProbe />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['cms'] }),
      bundle: { cms: en, core },
    },
  );
}

const COPY_ID = '00000000-0000-4000-8000-00000000c0c0';

describe.each([
  ['pages', <PagesListPage key="p" />, 'About', client.duplicatePage, ABOUT],
  ['blocks', <BlocksListPage key="b" />, 'Footer promo', client.duplicateBlock, '00000000-0000-4000-8000-0000000000b1'],
  ['templates', <TemplatesListPage key="t" />, 'Landing', client.duplicateTemplate, '00000000-0000-4000-8000-0000000000c1'],
] as const)('CMS %s list — Duplicate (DEC-17)', (kind, element, name, duplicate, id) => {
  it('offers Open, Duplicate and Delete, in that order', async () => {
    mount(element);
    await openRowMenu(name);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      en['listActions.open'],
      en['listActions.duplicate'],
      en['listActions.delete'],
    ]);
  });

  it('duplicates at once under the localized copy name and opens the copy', async () => {
    duplicate.mockResolvedValue({ id: COPY_ID });
    mountRouted(element);
    await openRowMenu(name);
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.duplicate']! }));
    await waitFor(() =>
      expect(duplicate).toHaveBeenCalledWith(id, { name: fill(en['duplicate.copyName']!, { name }) }),
    );
    expect(await screen.findByTestId('editor-probe')).toHaveTextContent(
      `/cms/${kind}/${COPY_ID} ${JSON.stringify(DUPLICATED_STATE)}`,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables Duplicate while a copy is being made, so a second select makes no second copy', async () => {
    duplicate.mockReturnValue(new Promise(() => undefined));
    mount(element);
    await openRowMenu(name);
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.duplicate']! }));
    await waitFor(() => expect(duplicate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: fill(en['listActions.label']!, { name }) }).closest('[aria-busy]'))
        .toHaveAttribute('aria-busy', 'true'),
    );
    await openRowMenu(name);
    const again = await screen.findByRole('menuitem', { name: en['listActions.duplicate']! });
    expect(again).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(again);
    expect(duplicate).toHaveBeenCalledTimes(1);
  });

  it('keeps the list and says why, in the operator\'s language, when the copy is refused', async () => {
    duplicate.mockRejectedValue(
      kind === 'pages'
        ? new ApiError(409, {
            error: { code: 'CMS_SLUG_RESERVED', message: 'reserved', details: { segment: 'o-nas-copy' } },
          } as never)
        : new ApiError(409, { error: { code: 'CMS_CODE_CONFLICT', message: 'conflict' } } as never),
    );
    mount(element);
    await openRowMenu(name);
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.duplicate']! }));
    const message =
      kind === 'pages' ? fill(en['duplicate.slugReserved']!, { segment: 'o-nas-copy' }) : en['duplicate.codeConflict']!;
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText(name)).toBeInTheDocument();
  });

  it('falls back to the retry line for any other failure', async () => {
    duplicate.mockRejectedValue(new Error('network'));
    mount(element);
    await openRowMenu(name);
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.duplicate']! }));
    expect(await screen.findByText(en['duplicate.failed']!)).toBeInTheDocument();
  });
});

describe('CMS duplicate — copy', () => {
  it('ships every duplicate key in English and Polish, with the same placeholders', () => {
    const keys = Object.keys(en).filter((key) => key.startsWith('duplicate.') || key === 'listActions.duplicate');
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const key of keys) {
      expect(pl[key], key).toBeTruthy();
      const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(pl[key]!), key).toEqual(placeholders(en[key]!));
    }
  });
});

describe('CMS editor — landing on a fresh copy (DEC-17)', () => {
  /** The editor's half of the hook, with a settings panel that starts closed, as an existing record's may. */
  function Editor({ ready }: { ready: boolean }): ReactNode {
    const [open, setOpen] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);
    const landed = useDuplicatedLanding({ ready, reveal: () => setOpen(true), open, nameRef });
    return (
      <>
        {landed ? <p role="status">{en['duplicate.created']}</p> : null}
        <button type="button">Other</button>
        {open ? <input aria-label="name" ref={nameRef} /> : null}
      </>
    );
  }

  function mountEditor(state: unknown, ready = true): void {
    renderWithSession(
      <MemoryRouter initialEntries={[{ pathname: '/cms/blocks/x', state }]}>
        <Routes>
          <Route path="/cms/blocks/:id" element={<Editor ready={ready} />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['cms'] }) },
    );
  }

  it('opens the settings, focuses the name and says a copy was made', async () => {
    mountEditor(DUPLICATED_STATE);
    const input = await screen.findByRole('textbox', { name: 'name' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.getByRole('status')).toHaveTextContent(en['duplicate.created']!);
  });

  it('does nothing when the editor was opened any other way', () => {
    mountEditor(null);
    expect(screen.queryByRole('textbox', { name: 'name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('waits for the record to load before it moves focus', () => {
    mountEditor(DUPLICATED_STATE, false);
    expect(screen.queryByRole('textbox', { name: 'name' })).not.toBeInTheDocument();
  });
});
