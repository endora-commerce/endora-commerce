import type { ReactNode } from 'react';
import { hasBlocks } from '../CategoryContent';
import { PageBuilderRender } from '../PageBuilderRender';

/**
 * One Page Builder content attribute of a product, in the "Opis" tab (feature
 * 172, `specs/172-product-content-attributes/` FR-030, FR-034, FR-037) — the
 * twin of `<CategoryContent>`.
 *
 * It goes through `PageBuilderRender`, the one boundary this storefront mounts
 * a Page Builder tree in, so the blocks, their HTML sanitisation and the
 * module-presence rule are the CMS' own: a block whose module is switched off
 * is not drawn here either. Server-rendered with the page (Principle VII).
 *
 * The document is shown exactly as authored: no heading, no label of its own
 * (OR-4). A document with no block renders nothing.
 */
export function ProductContent({
  attributeKey,
  content,
  language,
}: {
  attributeKey: string;
  content: unknown;
  /** The language the backend resolved the document to. */
  language: string;
}): ReactNode {
  if (!hasBlocks(content)) return null;
  return (
    <div data-product-content={attributeKey}>
      <PageBuilderRender data={content} language={language} />
    </div>
  );
}
