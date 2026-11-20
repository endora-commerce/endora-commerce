import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * Issue #1495 (UX audit CONTENT-13) — Archive and Unarchive on the CMS page
 * list's row menu. Archiving is reversible and the page editor does it without
 * asking, so the list does too: the row's badge changes in place, the result is
 * said in an always-mounted status region (DEC-12 a), and focus stays on the
 * row's menu trigger. A row that no longer matches the status filter leaves the
 * list, and focus moves to its neighbour (WCAG 2.4.3).
 */

const client = vi.hoisted(() => ({
  listPages: vi.fn(),
  deletePage: vi.fn(),
  archivePage: vi.fn(),
  unarchivePage: vi.fn(),
}));
vi.mock('../../../../packages/modules/cms/src/admin/api/cms-client', () => ({ cmsClient: client }));

const { PagesListPage } = await import('../../../../packages/modules/cms/src/admin/pages/PagesListPage');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/cms/i18n/en.json');
const pl = read('../packages/modules/cms/i18n/pl.json');
const core = read('../packages/modules/_i18n/i18n/en.json');

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

const ABOUT = '00000000-0000-4000-8000-000000000003';
const TERMS = '00000000-0000-4000-8000-000000000004';
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

function mount(): void {
  renderWithSession(
    <MemoryRouter>
      <PagesListPage />
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['cms'] }),
      bundle: { cms: en, core },
    },
  );
}

const trigger = (name: string): Promise<HTMLElement> =>
  screen.findByRole('button', { name: fill(en['listActions.label']!, { name }) });

async function openRowMenu(name: string): Promise<void> {
  fireEvent.pointerDown(await trigger(name), { button: 0, ctrlKey: false });
}

const rowOf = (name: string): HTMLElement => screen.getByRole('link', { name }).closest('tr')!;

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.listPages.mockResolvedValue({ data: [page()], nextCursor: null });
  client.archivePage.mockImplementation(async (id: string) => page({ id, status: 'archived' }));
  client.unarchivePage.mockImplementation(async (id: string) => page({ id, status: 'draft' }));
});

describe('CMS pages list — archive copy', () => {
  it('ships the archive keys in English and Polish', () => {
    for (const key of [
      'pagesList.archive',
      'pagesList.unarchive',
      'pagesList.archived',
      'pagesList.unarchived',
      'pagesList.archiveFailed',
      'pagesList.unarchiveFailed',
    ]) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
  });
});

describe('CMS pages list — Archive and Unarchive', () => {
  it('offers Archive for a live page, between Open and Delete', async () => {
    mount();
    await openRowMenu('About');
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual([en['listActions.open'], en['pagesList.archive'], en['listActions.delete']]);
  });

  it('offers Unarchive, not Archive, for an archived page', async () => {
    client.listPages.mockResolvedValue({ data: [page({ status: 'archived' })], nextCursor: null });
    mount();
    await openRowMenu('About');
    expect(await screen.findByRole('menuitem', { name: en['pagesList.unarchive']! })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: en['pagesList.archive']! })).not.toBeInTheDocument();
  });

  it('archives without asking, updates the badge in place, says so and keeps focus on the menu', async () => {
    mount();
    // The region is mounted before it has text, so the result is announced (SC 4.1.3).
    await screen.findByText('About');
    const region = screen
      .getAllByRole('status')
      .find((node) => node.getAttribute('aria-atomic') === 'true' && node.textContent === '');
    expect(region).toBeDefined();
    await openRowMenu('About');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['pagesList.archive']! }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(client.archivePage).toHaveBeenCalledWith(ABOUT));
    await waitFor(() => expect(within(rowOf('About')).getByText(en['status.archived']!)).toBeInTheDocument());
    expect(within(rowOf('About')).queryByText(en['status.published']!)).not.toBeInTheDocument();
    expect(region!.textContent).toBe(fill(en['pagesList.archived']!, { name: 'About' }));
    expect(document.activeElement).toBe(await trigger('About'));
  });

  it('unarchives back to a draft', async () => {
    client.listPages.mockResolvedValue({ data: [page({ status: 'archived' })], nextCursor: null });
    mount();
    await openRowMenu('About');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['pagesList.unarchive']! }));
    await waitFor(() => expect(client.unarchivePage).toHaveBeenCalledWith(ABOUT));
    await waitFor(() => expect(within(rowOf('About')).getByText(en['status.draft']!)).toBeInTheDocument());
    expect(await screen.findByText(fill(en['pagesList.unarchived']!, { name: 'About' }))).toBeInTheDocument();
  });

  it('drops a row the status filter no longer matches and moves focus to the next row', async () => {
    client.listPages.mockResolvedValue({
      data: [page(), page({ id: TERMS, name: 'Terms', slug: 'terms' })],
      nextCursor: null,
    });
    mount();
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: en['pagesList.statusFilter']! }),
      'published',
    );
    await waitFor(() =>
      expect(client.listPages).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'published' })),
    );
    await openRowMenu('About');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['pagesList.archive']! }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'About' })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Terms' }));
    expect(screen.getByText(fill(en['pagesList.archived']!, { name: 'About' }))).toBeInTheDocument();
  });

  it('moves focus to "New page" when the filtered list empties', async () => {
    mount();
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: en['pagesList.statusFilter']! }),
      'published',
    );
    await waitFor(() =>
      expect(client.listPages).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'published' })),
    );
    await openRowMenu('About');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['pagesList.archive']! }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'About' })).not.toBeInTheDocument());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('link', { name: en['pagesList.new']! })),
    );
  });

  it('keeps the row and says why when archiving fails', async () => {
    client.archivePage.mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'boom' } } as never),
    );
    mount();
    await openRowMenu('About');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['pagesList.archive']! }));
    expect(await screen.findByText(fill(en['pagesList.archiveFailed']!, { name: 'About' }))).toBeInTheDocument();
    expect(within(rowOf('About')).getByText(en['status.published']!)).toBeInTheDocument();
  });
});
