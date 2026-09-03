import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { CmsPageRenderer } from '../../../components/CmsPageRenderer';
import { getCmsPageBySlug, normalizeCmsUrlPath } from '../../../lib/api/cms';
import { tForLocale } from '../../../lib/i18n/messages';
import { getServerContext } from '../../../lib/server-context';
import { canonicalPath } from '../../../lib/seo/route-seo';
import { seo } from './seo';

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const path = normalizeCmsUrlPath(slug.join('/'));
  const { ctx } = await getServerContext();
  const page = await getCmsPageBySlug(path, ctx);
  if (!page) return { title: 'Not found', robots: { index: false, follow: false } };
  return {
    title: page.meta.title ?? page.name,
    description: page.meta.description ?? undefined,
    keywords: page.meta.keywords ?? undefined,
    // Indexable (FR-010/FR-012).
    alternates: { canonical: canonicalPath(seo.route, { slug }) },
  };
}

export default async function CmsBuilderPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const path = normalizeCmsUrlPath(slug.join('/'));
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  const page = await getCmsPageBySlug(path, ctx);
  if (!page) notFound();

  return (
    <>
      <div className="mx-auto max-w-[1360px] px-[24px] pt-[24px] max-md:pt-[16px]">
        <Breadcrumbs crumbs={[{ href: '/', label: t('nav.home') }, { href: `/cms/${path}`, label: page.name }]} />
      </div>
      <CmsPageRenderer page={page} />
    </>
  );
}
