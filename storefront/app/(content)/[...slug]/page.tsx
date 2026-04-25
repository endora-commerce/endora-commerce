import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { getCmsPage } from '../../../lib/api/cms';
import { getServerContext } from '../../../lib/server-context';
import { pickLocalizedString } from '../../../lib/i18n/locale';
import { tForLocale } from '../../../lib/i18n/messages';

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

/**
 * Catch-all CMS route. Resolves the requested URL to a published CMS
 * page; falls through to 404 otherwise. Body is rendered as plain
 * pre-formatted text in the reference theme — themes that need real
 * Markdown / blocks parsing replace the body renderer.
 */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const path = slug.join('/');
  const { ctx, locale } = await getServerContext();
  const page = await getCmsPage(path, ctx);
  if (!page) return { title: 'Not found' };
  const title = pickLocalizedString(page.title, locale);
  return { title };
}

export default async function CmsContentPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const path = slug.join('/');
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);

  const page = await getCmsPage(path, ctx);
  if (!page) notFound();

  const title = pickLocalizedString(page.title, locale);
  const body = pickLocalizedString(page.body, locale);

  return (
    <>
      <Breadcrumbs crumbs={[{ href: '/', label: t('nav.home') }, { href: `/${path}`, label: title }]} />
      <article>
        <h1>{title}</h1>
        <div className="b2b-cms-body">
          {/* Markdown-rich rendering is intentionally out of scope for the
              reference theme. Body is whitespace-preserving so editors can
              author paragraphs without escaping. Themes plug in their own
              renderer here (e.g. react-markdown, MDX). */}
          {body.split(/\n{2,}/).map((para, idx) => (
            <p key={idx}>{para}</p>
          ))}
        </div>
      </article>
    </>
  );
}
