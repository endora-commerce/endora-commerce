import type { PublicFormDefinition } from '@endora-commerce/contracts';
import type { CmsBlogPostCard } from '../schema/blog-types.js';
import type { CmsCategoryNode, CmsProductSummary } from '../schema/catalog-types.js';

export interface CatalogPreviewApi {
  fetchProductsBySlugs: (slugs: string[]) => Promise<CmsProductSummary[]>;
  fetchProductsList: (query: {
    categorySlug?: string;
    q?: string;
    limit?: number;
  }) => Promise<CmsProductSummary[]>;
  fetchCategoryTree: () => Promise<CmsCategoryNode[]>;
  /**
   * The editor's read of `blog.LatestPosts` (feature 163). Optional: an editor
   * without it previews the block through the public list API.
   */
  fetchBlogPosts?: (query: { limit: number; categorySlug?: string }) => Promise<CmsBlogPostCard[]>;
  /**
   * The editor's read of a `forms.Form` block's form (`specs/170-forms-module/`
   * contracts/blocks-and-storefront.md §3): the admin preview of the published
   * version — or of the working copy of a draft — with the note the canvas shows
   * for a draft, a closed form, a form that is gone and one the editor may not see.
   * Optional: an editor without it previews the block through the public read.
   */
  fetchForm?: (formId: string) => Promise<FormBlockData>;
}

/** Why the editor's canvas shows a note over a `forms.Form` block (US2-3). */
export type FormEditorNote = 'draft' | 'closed' | 'not_found' | 'forbidden';

/**
 * A form's read as a `forms.Form` block holds it: the public read, and — in the
 * editor only — the note the canvas shows. The storefront never sets the note.
 */
export type FormBlockData = PublicFormDefinition & {
  /** The canvas note and its words in the editor's language (the admin translates it). */
  readonly editorNote?: { readonly code: FormEditorNote; readonly message: string };
};

let previewApiGetter: (() => CatalogPreviewApi | null) | null = null;

export function registerCatalogPreviewGetter(getter: (() => CatalogPreviewApi | null) | null): void {
  previewApiGetter = getter;
}

export function getCatalogPreviewApi(): CatalogPreviewApi | null {
  return previewApiGetter?.() ?? null;
}
