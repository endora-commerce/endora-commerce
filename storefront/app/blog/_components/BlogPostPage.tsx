import type { ReactNode } from 'react';
import type { BlogBySlugPostResponse } from '@endora-commerce/contracts';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { JsonLd } from '../../../lib/seo/JsonLd';
import { absoluteUrl } from '../../../lib/seo/site-url';
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
      {/*
        `BlogPosting` — the type `blog/[[...slug]]/seo.ts` declares for the post
        view (`contracts/seo-declarations.md` §3). It is emitted here rather
        than in `page.tsx` because only this branch of that catch-all route is a
        post; the index, a category and a tag are lists and are not one.
      */}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.name,
          url: absoluteUrl(post.breadcrumb[post.breadcrumb.length - 1]?.url ?? `/blog/${post.slug}`),
          ...(post.publishedAt !== null ? { datePublished: post.publishedAt } : {}),
          ...(post.metaDescription !== null ? { description: post.metaDescription } : {}),
          ...(post.tags.length > 0 ? { keywords: post.tags.map((tag) => tag.name).join(', ') } : {}),
        }}
      />
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
