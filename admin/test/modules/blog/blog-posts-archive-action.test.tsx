import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * Issue #1495 (UX audit CONTENT-13) — Archive and Unarchive on the blog post
 * list's row menu. Archiving is reversible and the post editor does it without
 * asking, so the list does too: the badge and the version change in place, the
 * result is said in an always-mounted status region (DEC-12 a), and focus stays
 * on the row's menu trigger. Unarchive returns the post to a draft, as the CMS
 * page list does, rather than putting it back on the storefront unreviewed. A
 * row the status filter no longer matches leaves the list (WCAG 2.4.3).
 */

const client = vi.hoisted(() => ({
  listPosts: vi.fn(),
  deletePost: vi.fn(),
  archivePost: vi.fn(),
  unpublishPost: vi.fn(),
}));
vi.mock('../../../../packages/modules/blog/src/admin/api/blog-client', () => ({ blogClient: client }));

const { BlogPostListPage } = await import('../../../../packages/modules/blog/src/admin/pages/BlogPostListPage');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/blog/i18n/en.json');
const pl = read('../packages/modules/blog/i18n/pl.json');
const core = read('../packages/modules/_i18n/i18n/en.json');

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

const POST_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000a2';
const post = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: POST_ID,
  slug: 'hello',
  name: { 'en-US': 'Hello world' },
  status: 'published',
  active: true,
  languages: ['en-US'],
  version: 4,
  ...over,
});
const pagination = (totalItems: number): Record<string, number> => ({
  page: 1,
  perPage: 20,
  totalItems,
  totalPages: 1,
});

function mount(): void {
  renderWithSession(
    <MemoryRouter>
      <BlogPostListPage />
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['blog'] }),
      bundle: { blog: en, core },
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
  client.listPosts.mockResolvedValue({ data: [post()], pagination: pagination(1) });
  client.archivePost.mockImplementation(async (id: string, version: number) =>
    post({ id, status: 'archived', version: version + 1 }),
  );
  client.unpublishPost.mockImplementation(async (id: string, version: number) =>
    post({ id, status: 'draft', version: version + 1 }),
  );
});

describe('blog post list — archive copy', () => {
  it('ships the archive keys in English and Polish', () => {
    for (const key of [
      'postList.archive',
      'postList.unarchive',
      'postList.archived',
      'postList.unarchived',
      'postList.archiveFailed',
      'postList.unarchiveFailed',
    ]) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
  });
});

describe('blog post list — Archive and Unarchive', () => {
  it('offers Archive for a live post, between Open and Delete', async () => {
    mount();
    await openRowMenu('Hello world');
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual([en['listActions.open'], en['postList.archive'], en['listActions.delete']]);
  });

  it('offers Unarchive, not Archive, for an archived post', async () => {
    client.listPosts.mockResolvedValue({ data: [post({ status: 'archived' })], pagination: pagination(1) });
    mount();
    await openRowMenu('Hello world');
    expect(await screen.findByRole('menuitem', { name: en['postList.unarchive']! })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: en['postList.archive']! })).not.toBeInTheDocument();
  });

  it('archives at the row version without asking, updates the row in place and keeps focus on the menu', async () => {
    mount();
    await screen.findByText('Hello world');
    const region = screen
      .getAllByRole('status')
      .find((node) => node.getAttribute('aria-atomic') === 'true' && node.textContent === '');
    expect(region).toBeDefined();
    await openRowMenu('Hello world');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['postList.archive']! }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(client.archivePost).toHaveBeenCalledWith(POST_ID, 4));
    await waitFor(() => expect(within(rowOf('Hello world')).getByText(en['status.archived']!)).toBeInTheDocument());
    expect(within(rowOf('Hello world')).getByText('v5')).toBeInTheDocument();
    expect(region!.textContent).toBe(fill(en['postList.archived']!, { name: 'Hello world' }));
    expect(document.activeElement).toBe(await trigger('Hello world'));
  });

  it('unarchives back to a draft', async () => {
    client.listPosts.mockResolvedValue({ data: [post({ status: 'archived' })], pagination: pagination(1) });
    mount();
    await openRowMenu('Hello world');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['postList.unarchive']! }));
    await waitFor(() => expect(client.unpublishPost).toHaveBeenCalledWith(POST_ID, 4));
    await waitFor(() => expect(within(rowOf('Hello world')).getByText(en['status.draft']!)).toBeInTheDocument());
    expect(await screen.findByText(fill(en['postList.unarchived']!, { name: 'Hello world' }))).toBeInTheDocument();
  });

  it('drops a row the status filter no longer matches and moves focus to the next row', async () => {
    client.listPosts.mockResolvedValue({
      data: [post(), post({ id: OTHER_ID, slug: 'second', name: { 'en-US': 'Second post' } })],
      pagination: pagination(2),
    });
    mount();
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: en['postList.statusFilter']! }),
      'published',
    );
    await waitFor(() =>
      expect(client.listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'published' })),
    );
    await openRowMenu('Hello world');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['postList.archive']! }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Hello world' })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Second post' }));
    expect(screen.getByText(fill(en['postList.count']!, { count: 1 }))).toBeInTheDocument();
  });

  it('keeps the row and says why when archiving fails', async () => {
    client.archivePost.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'stale' } } as never),
    );
    mount();
    await openRowMenu('Hello world');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['postList.archive']! }));
    expect(
      await screen.findByText(fill(en['postList.archiveFailed']!, { name: 'Hello world' })),
    ).toBeInTheDocument();
    expect(within(rowOf('Hello world')).getByText(en['status.published']!)).toBeInTheDocument();
  });
});
