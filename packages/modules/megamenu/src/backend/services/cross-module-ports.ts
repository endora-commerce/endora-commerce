import type {
  AssetReadPort,
  AssetsLibraryPort,
  CatalogCategoryReadPort,
  CmsBlockReadPort,
  CmsPageReadPort,
  MegamenuAssetKind,
  MegamenuResolvedBlock,
} from '@endora-commerce/contracts';

/**
 * Everything this module reads outside itself, in one declaration
 * (`specs/110-instance-repository/` T118c).
 *
 * Until T118c this was two objects a composition root built —
 * `megamenuValidatorDeps` and `megamenuStorefrontDeps`, eight closures written
 * twice, once in `backend/src/composition.ts` and once in
 * `backend/test/helpers/test-server.ts`. Every one of them was a
 * `select … from categories | cms_pages | cms_blocks | assets` issued from a file
 * this module does not own, by a root that is nobody's declared dependency: an
 * operator switching `cms` off was told nothing about what stops, because the
 * edge existed nowhere a manifest could see it. The two roots also disagreed —
 * production dropped a deactivated category from the menu and the harness did
 * not, and production built `/c/<slug>` where the harness built `/catalog/<slug>`,
 * a path the storefront serves from nowhere.
 *
 * Every member is now its owner's **published** port, resolved per call by
 * `lazyPort` in `backend/index.ts`, so the gate is the registration's and the
 * edges are in this module's manifest `dependencies`.
 *
 * The four functions below are the judgements that used to live inside those
 * closures — a storefront URL's shape, which category counts as live, which
 * asset kinds a menu may embed, and what an absent language means. They are
 * functions of their ports rather than of a `ModuleContext`, so each is testable
 * over a stub with nothing composed.
 */
export interface MegamenuCrossModulePorts {
  /** `catalog` — a menu item's category target and its storefront URL. */
  readonly categories: Pick<CatalogCategoryReadPort, 'findById'>;
  /** `cms` — a menu item's page target and its storefront URL. */
  readonly pages: Pick<CmsPageReadPort, 'findById'>;
  /** `cms` — a menu item's block target, and the tree a panel inlines. */
  readonly blocks: Pick<CmsBlockReadPort, 'findById' | 'findLocalizedById'>;
  /** `assets_library` — the stored kind, which is what an item's target declares. */
  readonly assets: Pick<AssetReadPort, 'findById'>;
  /**
   * `assets_library` again, for the URL alone.
   *
   * Two ports for one asset because neither answers the whole question:
   * `AssetRecord` carries the stored `kind` and no resolved URL, and
   * `AssetDetail` carries the URL and no `kind`. `resolveUrl`, which is what
   * both roots called, **is published on no port** — D-223, in as many words —
   * so `getAsset` is the sanctioned way to turn an asset id into a URL and this
   * is the same two reads the roots issued.
   */
  readonly assetLibrary: Pick<AssetsLibraryPort, 'getAsset'>;
}

/** What a menu item renders an asset target or an icon as. */
export interface MegamenuAssetTarget {
  url: string;
  label: string | null;
  kind: MegamenuAssetKind;
}

/**
 * A category target's public storefront URL, or `null` for one a shopper may not
 * reach — which drops the item, and its children with it.
 *
 * `/c/<slug>` is the storefront's category route
 * (`storefront/app/(catalog)/c/[slug]`), and a module naming it is the tree's
 * established shape: `seo`'s sitemap builds `/c/`, `/p/` and `/<slug>` in its own
 * sources for the same three things. The composition roots disagreed about it —
 * the harness built `/catalog/<slug>`, which no route serves — and no test in the
 * tree read the value, so the harness's answer was wrong for as long as it
 * existed.
 *
 * **Deactivated and soft-deleted are both refusals**, which is production's
 * `is_active = true and deleted_at is null`. `liveOnly` is the port's word for
 * the second; `isActive` rides on the record because it is the caller's
 * judgement, and the admin-side existence check below deliberately makes the
 * opposite one.
 */
export async function resolveCategoryUrl(
  categories: MegamenuCrossModulePorts['categories'],
  categoryId: string,
): Promise<string | null> {
  const category = await categories.findById(categoryId, { liveOnly: true });
  if (!category || !category.isActive || !category.slug) return null;
  return `/c/${category.slug}`;
}

/**
 * A CMS page target's public storefront URL, or `null` when the page is gone.
 *
 * **No status or `active` narrowing**, which is what both roots did and is an
 * asymmetry with the category case above rather than an oversight of this drain:
 * a draft or deactivated page keeps its menu item and answers for itself when the
 * shopper follows the link. Changing it is a product decision, and T118c moves a
 * value rather than redesigning it.
 */
export async function resolveCmsPageUrl(
  pages: MegamenuCrossModulePorts['pages'],
  pageId: string,
): Promise<string | null> {
  const page = await pages.findById(pageId);
  if (!page?.slug) return null;
  return `/${page.slug}`;
}

/**
 * An asset target or icon, resolved to the three fields a menu payload carries.
 *
 * `null` for an asset that is gone, and for one whose stored kind a menu cannot
 * render: the library holds `pdf`, `certificate` and `other` as well, and
 * `MegamenuAssetKind` is the narrower pair. The narrowing is the roots' own
 * (`if (row.kind !== 'image' && row.kind !== 'video') return null`) and it is what
 * keeps the wire shape's union honest.
 *
 * **No `catch` around `getAsset`, deliberately.** It throws 404 for a row that is
 * gone, which the read above has already answered `null` for, so the only way to
 * reach it is an asset deleted between the two reads — and swallowing it would
 * also swallow `ModuleDisabledError`, which is the fail-open composition
 * checklist item 7 refuses. Neither root caught here either.
 */
export async function resolveMenuAsset(
  ports: Pick<MegamenuCrossModulePorts, 'assets' | 'assetLibrary'>,
  assetId: string,
): Promise<MegamenuAssetTarget | null> {
  const record = await ports.assets.findById(assetId);
  if (!record) return null;
  if (record.kind !== 'image' && record.kind !== 'video') return null;

  // D-223 — the URL arrives absolute; the module that built it is the only party
  // that knows which adapter produced it and whether it is signed.
  const detail = await ports.assetLibrary.getAsset(assetId);
  return { url: detail.url, label: record.label, kind: record.kind };
}

/**
 * The block a panel inlines, in the language the menu is being resolved for, or
 * `null` when there is nothing to inline — which drops the item.
 *
 * `schemaVersion: 1` is **this module's wire contract**
 * (`megamenuResolvedBlockSchema`) and not the CMS envelope's deprecated
 * `schema_version`, which is normalized away on read. It is a constant here for
 * the same reason it was a constant in the root closures: nothing produces a
 * second version of this payload shape, and the field belongs to whoever owns the
 * response.
 */
export async function resolveMenuBlock(
  blocks: MegamenuCrossModulePorts['blocks'],
  blockId: string,
  language: string,
): Promise<MegamenuResolvedBlock | null> {
  const block = await blocks.findLocalizedById(blockId, language);
  if (!block) return null;
  return {
    id: block.id,
    code: block.code,
    language: block.language,
    content: { schemaVersion: 1, data: block.data },
  };
}
