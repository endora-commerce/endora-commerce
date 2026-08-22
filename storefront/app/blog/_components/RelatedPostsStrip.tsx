import type { ReactNode } from 'react';
import type { BlogPostCard } from '@endora-commerce/contracts';
import { PostCard } from './PostCard';

export function RelatedPostsStrip({ posts }: { posts: BlogPostCard[] }): ReactNode {
  if (posts.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-2xl font-semibold text-[--ink-700]">Related posts</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}
