import type { ReactNode } from 'react';
import type { BlogAuthor } from '@endora-commerce/contracts';
import { tForLocale } from '../../../lib/i18n/messages';

/**
 * Feature 171 (US7) — the post's author: an administrator's name, avatar and the
 * biography in the page language (the backend already fell back to the channel
 * default). Nothing else about them reaches the page.
 */
export function AuthorBox({ author, locale }: { author: BlogAuthor; locale: string }): ReactNode {
  const t = tForLocale(locale);
  return (
    <aside
      data-test="post-author"
      aria-label={t('content.blog.author')}
      className="flex gap-4 rounded-lg border border-[--line] bg-[--surface-alt] p-4"
    >
      {author.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={author.avatarUrl} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" loading="lazy" />
      ) : null}
      <div className="space-y-1">
        <p className="font-mono text-xs uppercase tracking-wider text-[--ink-400]">{t('content.blog.author')}</p>
        <p className="font-semibold text-[--ink-700]">{author.name}</p>
        {author.bio ? <p className="text-sm text-[--ink-500]">{author.bio}</p> : null}
      </div>
    </aside>
  );
}
