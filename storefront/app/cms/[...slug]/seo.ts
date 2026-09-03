import type { RouteSeo } from '../../../lib/seo/route-seo';

/**
 * A page-builder CMS page.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/cms/[...slug]',
  jsonLd: ['BreadcrumbList'],
};
