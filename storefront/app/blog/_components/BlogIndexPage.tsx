import type { ReactNode } from 'react';
import type { BlogIndexResponse } from '@b2b/contracts';
import { CategoryTile } from './CategoryTile';
import { PostCard } from './PostCard';

export function BlogIndexPage({
  payload,
}: {
  payload: BlogIndexResponse;
}): ReactNode {
  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-4xl font-bold text-[--ink-700]">Blog</h1>
      </header>

      {payload.latestPosts.length > 0 ? (
        <section>
          <h2 className="mb-6 text-2xl font-semibold text-[--ink-700]">Latest posts</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {payload.latestPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-[--ink-400]">No posts yet — check back soon.</p>
      )}

      {payload.topLevelCategories.length > 0 ? (
        <section>
          <h2 className="mb-6 text-2xl font-semibold text-[--ink-700]">Categories</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {payload.topLevelCategories.map((category) => (
              <CategoryTile key={category.id} category={category} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
