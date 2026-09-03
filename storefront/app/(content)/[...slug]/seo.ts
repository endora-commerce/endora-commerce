import type { RouteSeo } from '../../../lib/seo/route-seo';

/**
 * A content CMS page, served at the site root.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/[...slug]',
  jsonLd: ['BreadcrumbList'],
};
