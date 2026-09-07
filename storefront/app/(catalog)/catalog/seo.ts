import type { RouteSeo } from '../../../lib/seo/route-seo';

/**
 * The whole catalogue listing.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/catalog',
  jsonLd: ['BreadcrumbList'],
};
