import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import type { BlogAlternates } from '@endora-commerce/contracts';
import { BlogIndexPage } from '../_components/BlogIndexPage';
import { BlogCategoryPage } from '../_components/BlogCategoryPage';
import { BlogPostPage } from '../_components/BlogPostPage';
import { BlogTagPage } from '../_components/BlogTagPage';
import {
  getBlogBySlug,
  getBlogIndex,
  getBlogRelatedProducts,
  getBlogTagByCode,
} from '../../../lib/api/blog';
import { getServerContext } from '../../../lib/server-context';
import { canonicalPath } from '../../../lib/seo/route-seo';
import { seo } from './seo';
import { localizedAlternates } from '../../../lib/i18n/navigation';
import { stripLocalePrefix } from '../../../lib/i18n/locale-path';
import { format } from '../../../lib/i18n/format';
import { tForLocale } from '../../../lib/i18n/messages';

interface PageProps {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Feature 171 (FR-014) — a page number past the last page of a list is a 404 on the
 * index, a category and a tag alike; page 1 of an empty list is the list's own page.
 */
function pastLastPage(pagination: { page: number; totalPages: number } | undefined): boolean {
  return pagination !== undefined && pagination.page > 1 && pagination.page > pagination.totalPages;
}

function readPage(searchParams: Record<string, string | string[] | undefined>): number | undefined {
  const raw = searchParams['page'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Feature 171 — a view's logical path under the operator's blog prefix: the URL the
 * backend composed (`blogPath`) without its language prefix, so `localizedAlternates`
 * adds each language's own. The route's path serves a payload cached before the
 * backend composed one.
 */
async function logicalPathOf(
  url: string | undefined,
  slug: string[] | undefined,
  page: number | undefined,
): Promise<string> {
  // OR-5 — page 2 on of a list is its own canonical page.
  const query = page !== undefined && page > 1 ? `?page=${page}` : '';
  if (url === undefined) return `${canonicalPath(seo.route, slug ? { slug } : {})}${query}`;
  const { urlState } = await getServerContext();
  return `${urlState ? stripLocalePrefix(url, urlState) : url}${query}`;
}

/**
 * Feature 171 (US4, FR-034) — a post's or category's canonical and `hreflang` links
 * are the paths the backend composed per language: its key under each language's
 * blog prefix. A payload cached before them falls back to one logical path with the
 * language prefix swapped.
 */
async function entryAlternates(
  url: string | undefined,
  alternates: BlogAlternates | undefined,
  slug: string[],
  page: number | undefined,
): Promise<{ canonical: string; languages?: Record<string, string> }> {
  if (url === undefined || alternates === undefined) {
    return localizedAlternates(await logicalPathOf(url, slug, page));
  }
  const query = page !== undefined && page > 1 ? `?page=${page}` : '';
  return {
    canonical: `${url}${query}`,
    languages: {
      ...alternates.languages,
      ...(alternates.xDefault !== null ? { 'x-default': alternates.xDefault } : {}),
    },
  };
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
    const payload = await getBlogIndex(ctx, readPage(sp));
    if (!payload) return { title: t('content.notFound.title'), robots: { index: false, follow: false } };
    const alternates = await localizedAlternates(await logicalPathOf(payload.url, undefined, readPage(sp)));
    return { title: t('content.blog.title'), alternates: { ...alternates, canonical: alternates.canonical } };
  }

  if (slug[0] === 'tag' && slug.length === 2) {
    const payload = await getBlogTagByCode(slug[1] as string, ctx, readPage(sp));
    if (!payload) return { title: t('content.notFound.title'), robots: { index: false, follow: false } };
    const alternates = await localizedAlternates(await logicalPathOf(payload.tag.url, slug, readPage(sp)));

    return {
      title: format(t('content.blog.tagTitle'), { tag: payload.tag.name }),
      alternates: { ...alternates, canonical: alternates.canonical },
    };
  }

  if (slug.length === 1) {
    const payload = await getBlogBySlug(slug[0] as string, ctx, readPage(sp));
    if (!payload) return { title: t('content.notFound.title'), robots: { index: false, follow: false } };
    // A former key: the page answers a redirect, and is no page of its own.
    if (payload.kind === 'redirect') return { robots: { index: false, follow: false } };
    if (payload.kind === 'category') {
      const alternates = await entryAlternates(payload.category.url, payload.category.alternates, slug, readPage(sp));

      return {
        title: payload.category.metaTitle ?? format(t('content.blog.categoryTitle'), { category: payload.category.name }),
        description: payload.category.metaDescription ?? undefined,
        keywords: payload.category.metaKeywords ?? undefined,
        alternates: { ...alternates, canonical: alternates.canonical },
      };
    }
    const alternates = await entryAlternates(payload.post.url, payload.post.alternates, slug, undefined);

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
  const { ctx, locale, modules } = await getServerContext();
  const language = ctx.locale ?? locale ?? 'en-US';

  // /blog → index
  if (!slug || slug.length === 0) {
    const payload = await getBlogIndex(ctx, readPage(sp));
    if (!payload || pastLastPage(payload.posts?.pagination)) notFound();
    return <BlogIndexPage payload={payload} locale={locale} />;
  }

  // /blog/tag/<code> → tag view
  if (slug[0] === 'tag' && slug.length === 2) {
    const payload = await getBlogTagByCode(slug[1] as string, ctx, readPage(sp));
    if (!payload || pastLastPage(payload.posts.pagination)) notFound();
    return <BlogTagPage payload={payload} locale={locale} />;
  }

  // /blog/<slug> → category | post (one slug only at v1)
  if (slug.length === 1) {
    const payload = await getBlogBySlug(slug[0] as string, ctx, readPage(sp));
    if (!payload) notFound();
    // Feature 171 — a former key, or a base slug of a language with its own key.
    if (payload.kind === 'redirect') permanentRedirect(payload.path);
    if (payload.kind === 'category') {
      if (pastLastPage(payload.posts.pagination)) notFound();
      return <BlogCategoryPage payload={payload} locale={locale} />;
    }
    // Issue #590 — the related products are read as the viewer, here, and not
    // in the post payload, which is cached for every visitor.
    const relatedProducts = await getBlogRelatedProducts(payload.post.relatedProductIds, ctx, modules);
    return (
      <BlogPostPage
        payload={payload}
        language={language}
        locale={locale}
        relatedProducts={relatedProducts}
        salesChannelCode={ctx.salesChannelCode}
      />
    );
  }

  notFound();
}
