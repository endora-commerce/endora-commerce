import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * Issue #1465 (UX audit CONTENT-07): the blog post and tag lists' search boxes
 * are named by a label, not only by a placeholder that disappears on typing.
 */
vi.mock('../../../../packages/modules/blog/src/admin/api/blog-client', () => ({
  blogClient: {
    listPosts: vi.fn(async () => ({ data: [], pagination: { page: 1, perPage: 20, totalPages: 1, totalItems: 0 } })),
    listTags: vi.fn(async () => ({ data: [], pagination: { page: 1, perPage: 20, totalPages: 1, totalItems: 0 } })),
  },
}));

const { BlogPostListPage } = await import('../../../../packages/modules/blog/src/admin/pages/BlogPostListPage');
const { BlogTagListPage } = await import('../../../../packages/modules/blog/src/admin/pages/BlogTagListPage');

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/blog/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}
const en = bundle('en');
const pl = bundle('pl');

function mount(element: React.ReactElement): void {
  renderWithSession(<MemoryRouter>{element}</MemoryRouter>, {
    session: adminSession({ permissions: ['*'] }),
    presence: modulePresence({ present: ['blog'] }),
    bundle: { blog: en },
  });
}

describe('blog lists — search boxes named by a label (#1465)', () => {
  it.each([
    ['posts', <BlogPostListPage key="posts" />, 'postList.searchLabel'],
    ['tags', <BlogTagListPage key="tags" />, 'tagList.searchLabel'],
  ] as const)('names the %s search box', async (_name, element, key) => {
    mount(element);
    expect(await screen.findByRole('searchbox', { name: en[key]! })).toBeInTheDocument();
    expect(pl[key]).toBeTruthy();
    expect(pl[key]).not.toBe(en[key]);
  });
});
