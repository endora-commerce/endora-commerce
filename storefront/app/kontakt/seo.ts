import type { RouteSeo } from '../../lib/seo/route-seo';

/**
 * Contact.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/kontakt',
  jsonLd: ['BreadcrumbList'],
};
