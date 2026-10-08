import type { ReactNode } from 'react';
import { PageBuilderRender } from './PageBuilderRender';

/**
 * Whether a Page Builder document would draw anything — a block at the top
 * level or in a legacy `zones` bucket. The backend already answers `null` for
 * a document with neither; this is the same test on this side of the wire, so
 * an empty wrapper never reaches the page whichever backend answered.
 */
function hasBlocks(content: unknown): content is Record<string, unknown> {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false;
  const tree = content as Record<string, unknown>;
  if (Array.isArray(tree['content']) && tree['content'].length > 0) return true;
  const zones = tree['zones'];
  if (zones && typeof zones === 'object') {
    return Object.values(zones).some((zone) => Array.isArray(zone) && zone.length > 0);
  }
  return false;
}

/**
 * The content an operator authored for a category's page (admin: Catalog →
 * Categories → Content), rendered above the product grid.
 *
 * It goes through `PageBuilderRender`, the one boundary this storefront mounts
 * a Page Builder tree in — the boundary a CMS page and a blog category
 * description use. That is what makes the blocks, their HTML sanitisation and
 * the module-presence rule the CMS' own rather than a second copy: a block
 * whose module is switched off is not drawn here either, and the surrounding
 * `<BlockRenderScope>` (root layout) supplies that answer.
 *
 * Server-rendered with the page (Principle VII). No content renders nothing —
 * no wrapper, no heading, no spacing.
 */
export function CategoryContent({
  content,
  language,
}: {
  content: unknown;
  /** The language the document was resolved to, when the backend named one. */
  language?: string | null | undefined;
}): ReactNode {
  if (!hasBlocks(content)) return null;
  return (
    <div data-category-content className="mb-6">
      <PageBuilderRender data={content} {...(language ? { language } : {})} />
    </div>
  );
}
