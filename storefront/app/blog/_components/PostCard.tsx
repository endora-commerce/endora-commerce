import type { ReactNode } from 'react';
import type { BlogPostCard } from '@endora-commerce/contracts';
import { LocalizedLink } from '../../../lib/i18n/localized-link';

const BLOG_PREFIX = '/blog';

function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(locale);
  } catch {
    return null;
  }
}

/** `locale` is the page language: the date is written the way its readers write one. */
export function PostCard({ post, locale }: { post: BlogPostCard; locale: string }): ReactNode {
  const date = formatDate(post.publishedAt, locale);
  return (
    <article
      data-test="post-card"
      className="group flex flex-col overflow-hidden rounded-lg border border-[--line] bg-[--surface] transition hover:shadow-lg"
    >
      <LocalizedLink href={`${BLOG_PREFIX}/${post.slug}`} className="block">
        {post.mainImageUrl ? (
          <div className="relative aspect-[16/9] overflow-hidden bg-[--surface-alt]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.mainImageUrl}
              alt=""
              className="h-full w-full object-cover transition group-hover:scale-105"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="flex aspect-[16/9] items-center justify-center bg-[--surface-alt] text-[--ink-300]">
            <span className="font-mono text-sm">{post.slug}</span>
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2 p-4">
          {date ? (
            <time
              className="font-mono text-xs uppercase tracking-wider text-[--ink-400]"
              dateTime={post.publishedAt ?? undefined}
            >
              {date}
            </time>
          ) : null}
          <h3 className="text-lg font-semibold leading-snug text-[--ink-700] group-hover:text-[--brand-700]">
            {post.name}
          </h3>
          {post.excerpt ? (
            <p className="line-clamp-3 text-sm text-[--ink-400]">{post.excerpt}</p>
          ) : null}
        </div>
      </LocalizedLink>
    </article>
  );
}
