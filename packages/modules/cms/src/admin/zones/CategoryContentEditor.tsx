import { useCallback, useState, type ReactNode } from 'react';
import type { Data } from '@puckeditor/core';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { PageBuilderEditor } from '../components/PageBuilderEditor.js';

/**
 * The Page Builder canvas on `catalog`'s category content screen.
 *
 * `catalog` owns a category's page content — the document, its storage and its
 * save — and no editor. It mounts `category.content.editor` and this module
 * contributes the canvas, which is the direction the two modules' manifests
 * leave open: `catalog` cannot be switched off and this module can, so
 * `catalog` may neither declare this module nor import it, while a contribution
 * is filtered by this module's own presence and its own permission before the
 * chunk is even fetched.
 *
 * The wrapper adapts the zone's props to the canvas' and nothing more. It
 * keeps the document in state because the canvas is handed its own edits back
 * (`data` in, `onChange` out), and reports each one to the host, which holds
 * the draft and does the saving. **It never saves**: the zone's contract gives
 * it no route to save to, and a second writer of another module's column is
 * what the seam exists to prevent.
 */
export type CategoryContentEditorProps = AdminZoneProps<'category.content.editor'>;

/** A stored document, or the empty one the canvas opens on. */
function toDocument(data: unknown): Data {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Data;
  return { root: { props: {} }, content: [] };
}

export function CategoryContentEditor({
  categoryId,
  language,
  data,
  onChange,
}: CategoryContentEditorProps): ReactNode {
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
      // canvas for another category or another language.
      contentKey={`category:${categoryId}:${language}`}
    />
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default CategoryContentEditor;
