import type { RouteSeo } from '../../../lib/seo/route-seo';

/**
 * Blog. One route file serves the index, a category, a tag and a post; `BlogPosting`
 * is emitted on a post and the trail on all four.
 *
 * `contracts/seo-declarations.md` §3 is the judgement this implements; the
 * check reads this declaration rather than holding a copy of that table.
 */
export const seo: RouteSeo = {
  route: '/blog/[[...slug]]',
  jsonLd: ['BlogPosting', 'BreadcrumbList'],
};
