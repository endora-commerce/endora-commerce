import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { CmsPageRenderer } from '../../../components/CmsPageRenderer';
import { getCmsPageBySlug, normalizeCmsUrlPath } from '../../../lib/api/cms';
import { getHomepageConfig } from '../../../lib/api/homepage';
import { tForLocale } from '../../../lib/i18n/messages';
import { getServerContext } from '../../../lib/server-context';
import { canonicalPath } from '../../../lib/seo/route-seo';
import { seo } from './seo';

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

/**
 * A CMS page, at the one address it has
 * (`specs/105-cms-root-page-urls/contracts/cms-page-url.md` §1).
 *
 * The row is resolved through `GET /api/v1/cms/pages/by-slug`, carrying the
 * request's language, so the backend narrows the served language against the
 * page's own and the channel's default and returns exactly one (§3.1 — case 1
 * of `specs/094-translation-boundary/`, where the reader's language is
 * resolvable at the moment the response is composed).
 *
 * There is no second CMS route type and no second renderer: `/cms/{path}` is a
 * permanent redirect configured in `next.config.js`, and the page-builder tree
 * is rendered by `CmsPageRenderer` here exactly as it is on the home page.
 */

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

export default async function CmsContentPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const path = normalizeCmsUrlPath(slug.join('/'));
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  const [page, { cmsPageSlug }] = await Promise.all([
    getCmsPageBySlug(path, ctx),
    getHomepageConfig(ctx),
  ]);
  if (!page) notFound();

  // The page an operator selected as the home page is served at `/` and
  // nowhere else (contract §1.3): the row does not gain a second address, it
  // changes which one it has. Answered in the page component rather than in
  // `generateMetadata` (§2.2) — a redirect here discards the metadata result,
  // so there is one place and nothing to keep in sync. It is asked *after* the
  // row resolves, so a home-page setting naming a page this channel does not
  // publish still answers 404 rather than redirecting to a different document.
  if (cmsPageSlug !== null && normalizeCmsUrlPath(cmsPageSlug) === path) permanentRedirect('/');

  return (
    <>
      <div className="mx-auto max-w-[1360px] px-[24px] pt-[24px] max-md:pt-[16px]">
        <Breadcrumbs crumbs={[{ href: '/', label: t('nav.home') }, { href: `/${path}`, label: page.name }]} />
      </div>
      <CmsPageRenderer page={page} />
    </>
  );
}
