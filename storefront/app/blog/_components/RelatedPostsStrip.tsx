import type { ReactNode } from 'react';
import type { BlogPostCard } from '@endora-commerce/contracts';
import { PostCard } from './PostCard';
import { tForLocale } from '../../../lib/i18n/messages';

export function RelatedPostsStrip({ posts, locale }: { posts: BlogPostCard[]; locale: string }): ReactNode {
  if (posts.length === 0) return null;
  const t = tForLocale(locale);
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-2xl font-semibold text-[--ink-700]">{t('content.blog.relatedPosts')}</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} locale={locale} />
        ))}
      </div>
    </section>
  );
}
