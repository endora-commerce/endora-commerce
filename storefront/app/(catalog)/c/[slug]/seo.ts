import type { RouteSeo } from '../../../../lib/seo/route-seo';

/**
 * A category listing: the trail to it, and the products on it.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/c/[slug]',
  jsonLd: ['BreadcrumbList', 'ItemList'],
};
