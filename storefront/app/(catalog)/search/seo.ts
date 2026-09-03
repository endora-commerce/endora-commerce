import type { RouteSeo } from '../../../lib/seo/route-seo';

/**
 * Search results. `jsonLd` is empty **as a declaration**: a search results page is not a
 * thing schema.org has a type for, and saying so is what distinguishes it from a
 * route nobody considered.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/search',
  jsonLd: [],
};
