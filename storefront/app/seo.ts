import type { RouteSeo } from '../lib/seo/route-seo';

/**
 * Home. The shop itself is the entity a crawler wants from this URL.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/',
  jsonLd: ['Organization'],
};
