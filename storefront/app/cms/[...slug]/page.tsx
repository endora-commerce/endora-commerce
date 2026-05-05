import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { CmsPageRenderer } from '../../../components/CmsPageRenderer';
import { getCmsPageBySlug, normalizeCmsUrlPath } from '../../../lib/api/cms';
import { tForLocale } from '../../../lib/i18n/messages';
import { getServerContext } from '../../../lib/server-context';

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const path = normalizeCmsUrlPath(slug.join('/'));
  const { ctx } = await getServerContext();
  const page = await getCmsPageBySlug(path, ctx);
  if (!page) return { title: 'Not found' };
  return {
    title: page.meta.title ?? page.name,
    description: page.meta.description ?? undefined,
    keywords: page.meta.keywords ?? undefined,
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
      <Breadcrumbs crumbs={[{ href: '/', label: t('nav.home') }, { href: `/cms/${path}`, label: page.name }]} />
      <CmsPageRenderer page={page} />
    </>
  );
}
