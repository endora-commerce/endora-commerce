import type { RouteSeo } from '../../../../lib/seo/route-seo';

/**
 * Product detail. `Offer` is nested inside `Product` rather than emitted beside it,
 * which is how schema.org expects a price; it is declared because Phase 4 asserts
 * the served HTML for it.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/p/[slug]',
  jsonLd: ['Product', 'Offer', 'BreadcrumbList'],
};
