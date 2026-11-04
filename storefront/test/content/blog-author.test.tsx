import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BlogBySlugPostResponse, BlogPostCard } from '@endora-commerce/contracts';
import { BlogPostPage } from '../../app/blog/_components/BlogPostPage';
import { PostCard } from '../../app/blog/_components/PostCard';

/**
 * Feature 171 (US7, FR-062/FR-065, T085) — a post shows its author: name, avatar and
 * the biography in the page language on the post page, the name on a card, and the
 * author as a `Person` in the post's structured data. A post without one shows none.
 */
const AUTHOR = { id: '99999999-2222-4333-8444-555555555555', name: 'Anna Kowalska', avatarUrl: 'https://cdn.test/anna.png' };

function post(author: BlogBySlugPostResponse['post']['author']): BlogBySlugPostResponse {
  return {
    kind: 'post',
    post: {
      id: '66666666-2222-4333-8444-555555555555',
      name: 'Jak wybrać wiertarkę',
      slug: 'jak-wybrac',
      publishedAt: null,
      metaTitle: null,
      metaDescription: null,
      metaKeywords: null,
      content: { schema_version: 1, languages: {} },
      tags: [],
      relatedPosts: [],
      relatedProducts: [],
      relatedProductIds: [],
      categories: [],
      breadcrumb: [],
      url: '/aktualnosci/jak-wybrac',
      authorId: author?.id ?? null,
      author,
    },
  };
}

const render = (payload: BlogBySlugPostResponse) =>
  renderToString(<BlogPostPage payload={payload} language="pl-PL" locale="pl-PL" relatedProducts={[]} salesChannelCode="b2b" />);

describe('the post shows its author (feature 171)', () => {
  it('shows the name, the avatar and the biography, and names a Person in the structured data', () => {
    const html = render(post({ ...AUTHOR, bio: 'Piszę o narzędziach.' }));
    expect(html).toContain('Anna Kowalska');
    expect(html).toContain('https://cdn.test/anna.png');
    expect(html).toContain('Piszę o narzędziach.');
    expect(html).toContain('"author":{"@type":"Person","name":"Anna Kowalska","image":"https://cdn.test/anna.png"}');
  });

  it('shows no author block and no author in the structured data when there is none', () => {
    const html = render(post(null));
    expect(html).not.toContain('data-test="post-author"');
    expect(html).not.toContain('"author"');
  });

  it('names the author on a card', () => {
    const card: BlogPostCard = {
      id: '11111111-2222-4333-8444-555555555555',
      slug: 'porady',
      name: 'Porady',
      publishedAt: null,
      excerpt: null,
      mainImageUrl: null,
      primaryCategorySlug: null,
      author: AUTHOR,
    };
    expect(renderToString(<PostCard post={card} locale="pl-PL" />)).toContain('Anna Kowalska');
  });
});
