import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { BlogIndexPage } from '../_components/BlogIndexPage';
import { BlogCategoryPage } from '../_components/BlogCategoryPage';
import { BlogPostPage } from '../_components/BlogPostPage';
import { BlogTagPage } from '../_components/BlogTagPage';
import {
  getBlogBySlug,
  getBlogIndex,
  getBlogTagByCode,
} from '../../../lib/api/blog';
import { getServerContext } from '../../../lib/server-context';
import { canonicalPath } from '../../../lib/seo/route-seo';
import { seo } from './seo';
import { localizedAlternates } from '../../../lib/i18n/navigation';
import { format } from '../../../lib/i18n/format';
import { tForLocale } from '../../../lib/i18n/messages';

interface PageProps {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readPage(searchParams: Record<string, string | string[] | undefined>): number | undefined {
  const raw = searchParams['page'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);

  // Indexable (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010/FR-012).
  // One route file serves four views, so the canonical is composed from the
  // resolved segments rather than declared once; a view that does not resolve
  // is `noindex`, because `page.tsx` answers it with `notFound()`.
  if (!slug || slug.length === 0) {
    const payload = await getBlogIndex(ctx);
    if (!payload) return { title: t('content.notFound.title'), robots: { index: false, follow: false } };
    const alternates = await localizedAlternates(canonicalPath(seo.route, {}));
    return { title: t('content.blog.title'), alternates: { ...alternates, canonical: alternates.canonical } };
  }

  if (slug[0] === 'tag' && slug.length === 2) {
    const payload = await getBlogTagByCode(slug[1] as string, ctx, readPage(sp));
    if (!payload) return { title: t('content.notFound.title'), robots: { index: false, follow: false } };
    const alternates = await localizedAlternates(canonicalPath(seo.route, { slug }));

    return {
      title: format(t('content.blog.tagTitle'), { tag: payload.tag.name }),
      alternates: { ...alternates, canonical: alternates.canonical },
    };
  }

  if (slug.length === 1) {
    const payload = await getBlogBySlug(slug[0] as string, ctx, readPage(sp));
    if (!payload) return { title: t('content.notFound.title'), robots: { index: false, follow: false } };
    if (payload.kind === 'category') {
      const alternates = await localizedAlternates(canonicalPath(seo.route, { slug }));

      return {
        title: payload.category.metaTitle ?? format(t('content.blog.categoryTitle'), { category: payload.category.name }),
        description: payload.category.metaDescription ?? undefined,
        keywords: payload.category.metaKeywords ?? undefined,
        alternates: { ...alternates, canonical: alternates.canonical },
      };
    }
    const alternates = await localizedAlternates(canonicalPath(seo.route, { slug }));

    return {
      title: payload.post.metaTitle ?? payload.post.name,
      description: payload.post.metaDescription ?? undefined,
      keywords: payload.post.metaKeywords ?? undefined,
      alternates: { ...alternates, canonical: alternates.canonical },
    };
  }

  return { title: t('content.notFound.title'), robots: { index: false, follow: false } };
}

export default async function BlogCatchAllPage({
  params,
  searchParams,
}: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const sp = await searchParams;
  const { ctx, locale } = await getServerContext();
  const language = ctx.locale ?? locale ?? 'en-US';

  // /blog → index
  if (!slug || slug.length === 0) {
    const payload = await getBlogIndex(ctx);
    if (!payload) notFound();
    return <BlogIndexPage payload={payload} locale={locale} />;
  }

  // /blog/tag/<code> → tag view
  if (slug[0] === 'tag' && slug.length === 2) {
    const payload = await getBlogTagByCode(slug[1] as string, ctx, readPage(sp));
    if (!payload) notFound();
    return <BlogTagPage payload={payload} locale={locale} />;
  }

  // /blog/<slug> → category | post (one slug only at v1)
  if (slug.length === 1) {
    const payload = await getBlogBySlug(slug[0] as string, ctx, readPage(sp));
    if (!payload) notFound();
    if (payload.kind === 'category') return <BlogCategoryPage payload={payload} locale={locale} />;
    return <BlogPostPage payload={payload} language={language} locale={locale} />;
  }

  notFound();
}
