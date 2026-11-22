import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { withLocalStorage } from '../../helpers/with-local-storage';
import { withViewportWidth } from '../../helpers/with-viewport-width';
import { BlogPostEditor } from '../../../../packages/modules/blog/src/admin/pages/BlogPostEditor';

/**
 * Issue #1512 (UX audit 2026-11-17, CONTENT-09; owner decision DEC-08) — the blog post editor
 * had two save models and said neither: the author, the tags and the related posts and products
 * each wrote the moment they were picked, while the name, the meta fields and the scope waited for
 * the header Save. DEC-08 folds the four into the one Save. What still writes on its own — the
 * address (URL key) panel — carries the kit's `ImmediateBadge` on its heading, and the result of a
 * save is an `InlineStatus` beside the Save button rather than a banner under the header.
 */
vi.mock('@endora-commerce/mod-cms/admin-ui', () => ({
  PageBuilderEditor: (): ReactElement => <div data-testid="canvas-stub" />,
}));

function bundleOf(pkg: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `../packages/modules/${pkg}/i18n/en.json`), 'utf8')) as Record<
    string,
    string
  >;
}

const en = bundleOf('blog');
const core = bundleOf('_i18n');
const IMMEDIATE = core['saveSession.immediateBadge']!;

function copy(key: string, params: Record<string, string> = {}): string {
  const value = en[key];
  if (!value) throw new Error(`blog/i18n/en.json carries no "${key}"`);
  return Object.entries(params).reduce((text, [k, v]) => text.replace(`{${k}}`, v), value);
}

const channel = { id: 'channel-1', code: 'web', name: { 'en-US': 'Web store' }, active: true, defaultLanguage: 'en-US' };

const AUTHOR_ID = '0b5f8f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const TAG_ID = '1c6a9b4f-2d3e-4f5a-9b0c-1d2e3f4a5b6c';
const OTHER_POST_ID = '2d7b0c5a-3e4f-4a5b-8c1d-2e3f4a5b6c7d';

const storedPost = {
  id: 'entity-1',
  name: { 'en-US': 'Stored entity' },
  slug: 'stored-entity',
  active: true,
  status: 'draft',
  publishedAt: null,
  description: null,
  mainImageAssetId: null,
  metaTitle: { 'en-US': 'Stored meta title' },
  metaDescription: null,
  metaKeywords: null,
  meta: null,
  content: { schema_version: 1, languages: {} },
  version: 3,
  salesChannelIds: ['channel-1'],
  languages: ['en-US'],
  categoryIds: [],
  tags: [],
  relatedPostIds: [],
  relatedProductIds: [],
  author: null,
};

const otherPost = { ...storedPost, id: OTHER_POST_ID, name: { 'en-US': 'Another post' }, slug: 'another-post' };

let patch: ReturnType<typeof vi.spyOn>;
let put: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  withLocalStorage();
  withViewportWidth(1920);
  vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels?')) {
      return Promise.resolve({ items: [channel], page: 1, pageSize: 100, total: 1 } as never);
    }
    if (path.startsWith('/api/v1/admin/sales-channels/')) {
      return Promise.resolve({ ...channel, languages: ['en-US'] } as never);
    }
    if (/\/api\/v1\/admin\/blog\/posts\/entity-1$/.test(path)) return Promise.resolve({ data: storedPost } as never);
    if (path.endsWith('/url-keys')) {
      return Promise.resolve({ data: { slug: 'stored', keys: [], effective: [], version: 3 } } as never);
    }
    if (path.startsWith('/api/v1/admin/blog/author-candidates')) {
      return Promise.resolve({ data: [{ id: AUTHOR_ID, name: 'Ada Author', avatarUrl: null }] } as never);
    }
    if (path.startsWith('/api/v1/admin/blog/tags')) {
      return Promise.resolve({
        data: [{ id: TAG_ID, code: 'news', name: { 'en-US': 'News' } }],
        pagination: { page: 1, perPage: 100, totalPages: 1, totalItems: 1 },
      } as never);
    }
    if (path.startsWith('/api/v1/admin/blog/posts')) {
      return Promise.resolve({
        data: [storedPost, otherPost],
        pagination: { page: 1, perPage: 50, totalPages: 1, totalItems: 2 },
      } as never);
    }
    return Promise.resolve({ data: [], pagination: { page: 1, perPage: 50, totalPages: 1, totalItems: 0 } } as never);
  });
  let version = 3;
  patch = vi.spyOn(apiClient, 'patch').mockImplementation(() => {
    version += 1;
    return Promise.resolve({ data: { ...storedPost, version } } as never);
  });
  put = vi.spyOn(apiClient, 'put').mockImplementation(() => {
    version += 1;
    return Promise.resolve({ data: { ...storedPost, version } } as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderEditor(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/blog/posts/entity-1']}>
      <Routes>
        <Route path="/blog/posts/:id" element={<BlogPostEditor />} />
        <Route path="/blog/posts" element={<p>Post list</p>} />
      </Routes>
    </MemoryRouter>,
    { blog: en, core },
  );
}

async function loaded(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Stored entity' });
  await screen.findByTestId('canvas-stub');
}

function settings(): HTMLElement {
  return screen.getByRole('complementary', { name: core['pageBuilder.editorLayout.settings']! });
}

/** The heading of the settings group whose title starts with `title`. */
function heading(title: string): HTMLElement {
  const found = [...settings().querySelectorAll<HTMLElement>('h2, h3')].find((element) =>
    (element.textContent ?? '').startsWith(title),
  );
  if (!found) throw new Error(`no settings heading starts with "${title}"`);
  return found;
}

async function pickEverything(): Promise<void> {
  const authorSelect = await within(settings()).findByLabelText(copy('author.label'));
  await within(authorSelect).findByRole('option', { name: 'Ada Author' });
  fireEvent.change(authorSelect, { target: { value: AUTHOR_ID } });
  fireEvent.click(await within(settings()).findByRole('button', { name: /News/ }));
  fireEvent.click(await within(settings()).findByRole('button', { name: /Another post/ }));
}

describe('BlogPostEditor — author, tags and related items join the one Save (#1512, DEC-08)', () => {
  it('writes nothing when the author, a tag or a related post is picked, and says the post is unsaved', async () => {
    renderEditor();
    await loaded();
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe('');

    await pickEverything();

    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByTestId('unsaved-changes-hint').textContent).not.toBe('');
  });

  it('saves them with the header Save, each request on the version the previous one answered with', async () => {
    renderEditor();
    await loaded();
    await pickEverything();

    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledTimes(1);
    const [, patchBody] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(patchBody).toMatchObject({ authorAdminUserId: AUTHOR_ID, tagIds: [TAG_ID], version: 3 });
    const [putPath, putBody] = put.mock.calls[0] as [string, Record<string, unknown>];
    expect(putPath).toBe('/api/v1/admin/blog/posts/entity-1/related-posts');
    expect(putBody).toEqual({ relatedPostIds: [OTHER_POST_ID], version: 4 });
  });

  it('sends neither the tags nor the author when they were not changed', async () => {
    renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [, patchBody] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(patchBody).not.toHaveProperty('tagIds');
    expect(patchBody).not.toHaveProperty('authorAdminUserId');
    expect(put).not.toHaveBeenCalled();
  });

  it('says the result beside the Save button, in a live region that was there before it', async () => {
    renderEditor();
    await loaded();
    const save = screen.getByRole('button', { name: copy('common.save') });
    const group = save.closest('[data-save-actions]') as HTMLElement;
    expect(group).not.toBeNull();
    const status = within(group).getByRole('status');
    expect(status.textContent).toBe('');

    fireEvent.click(save);

    await waitFor(() => expect(status.textContent).toContain(copy('messages.saved')));
    // Not a banner of its own under the header.
    expect(screen.queryByText(copy('messages.saved'), { selector: '[data-slot="alert-description"], [role="alert"] *' })).toBeNull();
  });

  it('clears the "Saved." beside Save on the next edit, so it never sits beside unsaved changes', async () => {
    renderEditor();
    await loaded();
    const status = within(screen.getByRole('button', { name: copy('common.save') }).closest('[data-save-actions]') as HTMLElement).getByRole(
      'status',
    );
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(status.textContent).toContain(copy('messages.saved')));

    fireEvent.change(screen.getByLabelText(copy('fields.namePerLanguage'), { selector: 'input' }), {
      target: { value: 'Edited name' },
    });

    await waitFor(() => expect(status.textContent).toBe(''));
  });

  it('puts the Immediate badge on the address panel only, which still saves on its own', async () => {
    renderEditor();
    await loaded();
    await within(settings()).findByText(copy('urlKeys.title', { language: 'en-US' }));

    expect(heading(copy('urlKeys.title', { language: 'en-US' })).textContent).toContain(IMMEDIATE);
    for (const key of ['author.title', 'sections.tags', 'sections.relatedPosts', 'sections.relatedProducts', 'sections.metadata', 'sections.seo']) {
      expect(heading(copy(key)).textContent, key).not.toContain(IMMEDIATE);
    }
  });

  it('discards the picked author, tags and related posts with the rest of the draft', async () => {
    renderEditor();
    await loaded();
    await pickEverything();

    fireEvent.click(screen.getByRole('link', { name: copy('postList.title') }));
    fireEvent.click(await screen.findByRole('button', { name: core['form.unsavedChanges.discard']! }));

    expect(await screen.findByText('Post list')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
