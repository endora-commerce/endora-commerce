import { useCallback, useState, type ReactNode } from 'react';
import type { Data } from '@puckeditor/core';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { PageBuilderEditor } from '../components/PageBuilderEditor.js';

/**
 * The Page Builder canvas on `catalog`'s product content screen (feature 172,
 * `specs/172-product-content-attributes/` contracts/admin-surfaces.md §2) — the
 * twin of `CategoryContentEditor`, for one product × content attribute in
 * one language.
 *
 * `catalog` owns the document, its storage and its save, and no editor; it
 * mounts `product.content.editor` and this module contributes the canvas. The
 * direction is the category one, for the same reason: `catalog` cannot be
 * switched off and this module can, so `catalog` may neither declare this
 * module nor import it, while a contribution is filtered by this module's own
 * presence and permission before its chunk is fetched.
 *
 * The full block palette (OR-3): no `context` restricts it. The zone knows its
 * language, so the canvas offers Translate (feature 151); its result reaches
 * storage only through the host's save. **It never saves.**
 */
export type ProductContentEditorProps = AdminZoneProps<'product.content.editor'>;

/** A stored document, or the empty one the canvas opens on. */
function toDocument(data: unknown): Data {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Data;
  return { root: { props: {} }, content: [] };
}

export function ProductContentEditor({
  productId,
  attributeKey,
  language,
  data,
  onChange,
}: ProductContentEditorProps): ReactNode {
  const [document, setDocument] = useState<Data>(() => toDocument(data));
  // Stable for as long as the host's callback is: the canvas keys its own
  // change handler on this identity.
  const handleChange = useCallback(
    (next: Data): void => {
      setDocument(next);
      onChange(next);
    },
    [onChange],
  );
  return (
    <PageBuilderEditor
      data={document}
      onChange={handleChange}
      // Puck seeds from `data` on mount only, so the key is what re-seeds the
      // canvas for another product, attribute or language.
      contentKey={`product:${productId}:${attributeKey}:${language}`}
      activeLanguage={language}
      resource={{ type: 'catalog_product_content', id: productId }}
    />
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default ProductContentEditor;
