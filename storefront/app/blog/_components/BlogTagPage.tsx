import type { ReactNode } from 'react';
import type { BlogTagByCodeResponse } from '@endora-commerce/contracts';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { Pagination } from './Pagination';
import { PostCard } from './PostCard';

const BLOG_PREFIX = '/blog';

export function BlogTagPage({
  payload,
}: {
  payload: BlogTagByCodeResponse;
}): ReactNode {
  const { tag, posts } = payload;
  return (
    <div className="space-y-8">
      <Breadcrumbs
        crumbs={payload.breadcrumb.map((c) => ({ href: c.url, label: c.name }))}
      />

      <header className="space-y-2">
        <h1 className="text-4xl font-bold text-[--ink-700]">#{tag.name}</h1>
        {tag.description ? (
          <p className="text-[--ink-400]">{tag.description}</p>
        ) : null}
      </header>

      {posts.data.length === 0 ? (
        <p className="text-[--ink-400]">No posts carry this tag yet.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.data.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      <Pagination
        basePath={`${BLOG_PREFIX}/tag/${tag.code}`}
        page={posts.pagination.page}
        totalPages={posts.pagination.totalPages}
      />
    </div>
  );
}
