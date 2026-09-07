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
  const { ctx } = await getServerContext();

  // Indexable (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010/FR-012).
  // One route file serves four views, so the canonical is composed from the
  // resolved segments rather than declared once; a view that does not resolve
  // is `noindex`, because `page.tsx` answers it with `notFound()`.
  if (!slug || slug.length === 0) {
    const payload = await getBlogIndex(ctx);
    if (!payload) return { title: 'Not found', robots: { index: false, follow: false } };
    return { title: 'Blog', alternates: { canonical: canonicalPath(seo.route, {}) } };
  }

  if (slug[0] === 'tag' && slug.length === 2) {
    const payload = await getBlogTagByCode(slug[1] as string, ctx, readPage(sp));
    if (!payload) return { title: 'Not found', robots: { index: false, follow: false } };
    return {
      title: `#${payload.tag.name} — Blog`,
      alternates: { canonical: canonicalPath(seo.route, { slug }) },
    };
  }

  if (slug.length === 1) {
    const payload = await getBlogBySlug(slug[0] as string, ctx, readPage(sp));
    if (!payload) return { title: 'Not found', robots: { index: false, follow: false } };
    if (payload.kind === 'category') {
      return {
        title: payload.category.metaTitle ?? `${payload.category.name} — Blog`,
        description: payload.category.metaDescription ?? undefined,
        keywords: payload.category.metaKeywords ?? undefined,
        alternates: { canonical: canonicalPath(seo.route, { slug }) },
      };
    }
    return {
      title: payload.post.metaTitle ?? payload.post.name,
      description: payload.post.metaDescription ?? undefined,
      keywords: payload.post.metaKeywords ?? undefined,
      alternates: { canonical: canonicalPath(seo.route, { slug }) },
    };
  }

  return { title: 'Not found', robots: { index: false, follow: false } };
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
    return <BlogIndexPage payload={payload} />;
  }

  // /blog/tag/<code> → tag view
  if (slug[0] === 'tag' && slug.length === 2) {
    const payload = await getBlogTagByCode(slug[1] as string, ctx, readPage(sp));
    if (!payload) notFound();
    return <BlogTagPage payload={payload} />;
  }

  // /blog/<slug> → category | post (one slug only at v1)
  if (slug.length === 1) {
    const payload = await getBlogBySlug(slug[0] as string, ctx, readPage(sp));
    if (!payload) notFound();
    if (payload.kind === 'category') return <BlogCategoryPage payload={payload} />;
    return <BlogPostPage payload={payload} language={language} />;
  }

  notFound();
}
