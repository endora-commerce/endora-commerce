import type { ReactNode } from 'react';
import type { BlogBySlugPostResponse } from '@b2b/contracts';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { BlogPostBody } from './BlogPostBody';
import { RelatedPostsStrip } from './RelatedPostsStrip';
import { RelatedProductsStrip } from './RelatedProductsStrip';
import { TagChipStrip } from './TagChipStrip';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return null;
  }
}

export function BlogPostPage({
  payload,
  language,
}: {
  payload: BlogBySlugPostResponse;
  language: string;
}): ReactNode {
  const { post } = payload;
  const date = formatDate(post.publishedAt);
  return (
    <article className="mx-auto max-w-4xl space-y-8">
      <Breadcrumbs crumbs={post.breadcrumb.map((c) => ({ href: c.url, label: c.name }))} />

      <header className="space-y-3">
        {date ? (
          <time
            dateTime={post.publishedAt ?? undefined}
            className="font-mono text-xs uppercase tracking-wider text-[--ink-400]"
          >
            {date}
          </time>
        ) : null}
        <h1 className="text-4xl font-bold leading-tight text-[--ink-700]">{post.name}</h1>
      </header>

      <div className="prose prose-slate max-w-none">
        <BlogPostBody content={post.content} language={language} />
      </div>

      <TagChipStrip tags={post.tags} />
      <RelatedPostsStrip posts={post.relatedPosts} />
      <RelatedProductsStrip products={post.relatedProducts} />
    </article>
  );
}
