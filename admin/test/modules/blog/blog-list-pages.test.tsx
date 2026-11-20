import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { answerConfirm } from '../../helpers/confirm-dialog';

/**
 * Issue #1495 (UX audit CONTENT-13) and #1538 (CONTENT-21) — the blog post,
 * tag and category lists: no card titled with the page's own title, the kit
 * pager instead of a hand-rolled one, statuses as translated badges, a row
 * action menu with a confirmed delete through the module's own endpoint, and
 * the tag form in a dialog instead of a card drawn open above the list.
 */

const client = vi.hoisted(() => ({
  listPosts: vi.fn(),
  deletePost: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  patchTag: vi.fn(),
  deleteTag: vi.fn(),
  getTagInboundReferences: vi.fn(),
  getCategoryTree: vi.fn(),
  applyCategoryTreeMoves: vi.fn(),
  deleteCategory: vi.fn(),
}));
vi.mock('../../../../packages/modules/blog/src/admin/api/blog-client', () => ({ blogClient: client }));

const { BlogPostListPage } = await import('../../../../packages/modules/blog/src/admin/pages/BlogPostListPage');
const { BlogTagListPage } = await import('../../../../packages/modules/blog/src/admin/pages/BlogTagListPage');
const { BlogCategoryTreePage } = await import('../../../../packages/modules/blog/src/admin/pages/BlogCategoryTreePage');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/blog/i18n/en.json');
const pl = read('../packages/modules/blog/i18n/pl.json');
const core = read('../packages/modules/_i18n/i18n/en.json');

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

const POST_ID = '00000000-0000-4000-8000-0000000000a1';
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
const TAG_ID = '00000000-0000-4000-8000-0000000000e1';
const tag = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: TAG_ID,
  code: 'comparison',
  name: { 'en-US': 'Comparison' },
  description: null,
  version: 2,
  ...over,
});
const pagination = (totalItems: number, perPage = 20): Record<string, number> => ({
  page: 1,
  perPage,
  totalItems,
  totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
});

function mount(element: ReactElement, permissions: string[] = ['*']): void {
  renderWithSession(<MemoryRouter>{element}</MemoryRouter>, {
    session: adminSession({ permissions }),
    presence: modulePresence({ present: ['blog'] }),
    bundle: { blog: en, core },
  });
}

async function openRowMenu(name: string): Promise<void> {
  const trigger = await screen.findByRole('button', { name: fill(en['listActions.label']!, { name }) });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.listPosts.mockResolvedValue({ data: [post()], pagination: pagination(1) });
  client.listTags.mockResolvedValue({ data: [tag()], pagination: pagination(1) });
  client.getTagInboundReferences.mockResolvedValue({ totalPosts: 0, posts: [] });
  client.getCategoryTree.mockResolvedValue({ tree: [] });
  client.deletePost.mockResolvedValue({ detachedFromParents: [] });
  client.deleteTag.mockResolvedValue(undefined);
  client.createTag.mockResolvedValue(tag());
  client.patchTag.mockResolvedValue(tag());
});

describe('blog lists — copy', () => {
  it('ships every list key in English and Polish, and retires the card titles', () => {
    const keys = Object.keys(en).filter((key) => /^(listActions|postList|tagList|categoryTree|status)\./.test(key));
    for (const key of keys) expect(pl[key], key).toBeTruthy();
    for (const list of ['postList', 'tagList', 'categoryTree']) {
      expect(en[`${list}.cardTitle`], list).toBeUndefined();
      expect(pl[`${list}.cardTitle`], list).toBeUndefined();
    }
    // The locale is not copy (CONTENT-21).
    expect(en['tagList.descriptionLabel']).not.toMatch(/en-US/);
  });
});

describe('blog post list', () => {
  it('has one heading — the page title', async () => {
    mount(<BlogPostListPage />);
    await screen.findByText('Hello world');
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]!.textContent).toBe(en['postList.title']);
  });

  it('draws the status as a translated badge', async () => {
    client.listPosts.mockResolvedValue({ data: [post({ status: 'draft', active: false })], pagination: pagination(1) });
    renderWithSession(
      <MemoryRouter>
        <BlogPostListPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['blog'] }),
        bundle: { blog: pl, core },
      },
    );
    expect(await screen.findByText(pl['status.draft']!)).toBeInTheDocument();
    expect(screen.getByText(pl['status.inactive']!)).toBeInTheDocument();
  });

  it('pages through the kit pager, asking the server for the page', async () => {
    client.listPosts.mockResolvedValue({ data: [post()], pagination: pagination(45) });
    mount(<BlogPostListPage />);
    await screen.findByText('Hello world');
    expect(client.listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
    await userEvent.click(screen.getByRole('button', { name: new RegExp(core['common.pagination.next']!) }));
    await waitFor(() => expect(client.listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('searches as the operator types', async () => {
    mount(<BlogPostListPage />);
    const search = await screen.findByRole('searchbox', { name: en['postList.searchLabel']! });
    await userEvent.type(search, 'hel');
    await waitFor(() => expect(client.listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'hel' })));
  });

  it('deletes a post through the confirmation, naming the version it read', async () => {
    mount(<BlogPostListPage />);
    await openRowMenu('Hello world');
    const open = await screen.findByRole('menuitem', { name: en['listActions.open']! });
    expect(open.getAttribute('href')).toBe(`/blog/posts/${POST_ID}`);
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    expect(
      within(await screen.findByRole('dialog')).getByText(fill(en['postList.deleteConfirm']!, { name: 'Hello world' })),
    ).toBeInTheDocument();
    await answerConfirm(true);
    await waitFor(() => expect(client.deletePost).toHaveBeenCalledWith(POST_ID, 4));
    expect(await screen.findByText(fill(en['postList.deleted']!, { name: 'Hello world' }))).toBeInTheDocument();
  });

  it('offers no row actions without blog.write', async () => {
    mount(<BlogPostListPage />, ['blog.read']);
    await screen.findByText('Hello world');
    expect(screen.queryByRole('button', { name: fill(en['listActions.label']!, { name: 'Hello world' }) })).not.toBeInTheDocument();
  });
});

describe('blog tag list', () => {
  it('draws no form above the list; "New tag" opens it in a dialog', async () => {
    mount(<BlogTagListPage />);
    await screen.findByText('Comparison');
    expect(screen.queryByRole('textbox', { name: en['tagList.nameLabel']! })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: en['tagList.newTag']! }));
    const dialog = await screen.findByRole('dialog', { name: en['tagList.newTag']! });
    await userEvent.type(within(dialog).getByRole('textbox', { name: en['tagList.nameLabel']! }), 'Buyer guides');
    // The code follows the name (Tesler).
    expect((within(dialog).getByRole('textbox', { name: en['tagList.codeLabel']! }) as HTMLInputElement).value).toBe('buyer-guides');
    await userEvent.click(within(dialog).getByRole('button', { name: en['tagList.createTag']! }));
    await waitFor(() =>
      expect(client.createTag).toHaveBeenCalledWith(expect.objectContaining({ code: 'buyer-guides', name: { 'en-US': 'Buyer guides' } })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits a tag from the row menu, in the same dialog', async () => {
    mount(<BlogTagListPage />);
    await openRowMenu('Comparison');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.edit']! }));
    const dialog = await screen.findByRole('dialog', { name: en['tagList.editTag']! });
    const name = within(dialog).getByRole('textbox', { name: en['tagList.nameLabel']! }) as HTMLInputElement;
    expect(name.value).toBe('Comparison');
    await userEvent.clear(name);
    await userEvent.type(name, 'Comparisons');
    await userEvent.click(within(dialog).getByRole('button', { name: en['tagList.saveTag']! }));
    await waitFor(() =>
      expect(client.patchTag).toHaveBeenCalledWith(TAG_ID, expect.objectContaining({ name: { 'en-US': 'Comparisons' }, version: 2 })),
    );
  });

  it('links an invalid field to its error instead of a banner', async () => {
    mount(<BlogTagListPage />);
    await userEvent.click(await screen.findByRole('button', { name: en['tagList.newTag']! }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: en['tagList.createTag']! }));
    const nameInput = within(dialog).getByRole('textbox', { name: en['tagList.nameLabel']! });
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(client.createTag).not.toHaveBeenCalled();
  });

  it('deletes a tag through the confirmation', async () => {
    mount(<BlogTagListPage />);
    await openRowMenu('Comparison');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    await answerConfirm(true);
    await waitFor(() => expect(client.deleteTag).toHaveBeenCalledWith(TAG_ID, 2));
  });

  it('moves focus to the empty state\'s "New tag" once the last tag is deleted', async () => {
    client.listTags
      .mockResolvedValueOnce({ data: [tag()], pagination: pagination(1) })
      .mockResolvedValue({ data: [], pagination: pagination(0) });
    mount(<BlogTagListPage />);
    await openRowMenu('Comparison');
    await userEvent.click(await screen.findByRole('menuitem', { name: en['listActions.delete']! }));
    await answerConfirm(true);
    await screen.findByText(en['tagList.emptyTitle']!);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: en['tagList.newTag']! })));
  });
});

describe('blog category tree', () => {
  it('has one heading and the kit empty state with the create action', async () => {
    mount(<BlogCategoryTreePage />);
    expect(await screen.findByText(en['categoryTree.emptyTitle']!)).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: en['categoryTree.newCategory']! })).toHaveLength(1);
  });
});
