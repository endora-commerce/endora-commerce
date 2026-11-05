import {
  effectiveCustomerGroupId,
  type AssetReadPort,
  type CatalogCategoryReadPort,
  type CmsBlockReadPort,
  type CmsPageReadPort,
  type CustomerAccountReadPort,
  type CustomerGroupReadPort,
  type MegamenuAssetKind,
  type MegamenuResolvedBlock,
  type OrganizationDetailsPort,
  type ProductAudience,
} from '@endora-commerce/contracts';
import type { MenuViewer } from './audience.js';

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
 * The functions below are the judgements that used to live inside those
 * closures — which asset kinds a menu may embed and what an absent language
 * means. The other two — a category's and a page's storefront URL — moved with
 * feature 168 to `category-tree.ts` (one catalogue read per menu) and to `cms`'
 * `findStorefrontLinks` (a page's address in the served language). They are
 * functions of their ports rather than of a `ModuleContext`, so each is testable
 * over a stub with nothing composed.
 */
export interface MegamenuCrossModulePorts {
  /**
   * `catalog` — a menu item's category target, and (feature 168) the whole
   * live tree once per resolution, which every category link and category tree
   * of the menu reads.
   */
  readonly categories: Pick<CatalogCategoryReadPort, 'findById' | 'listAll'>;
  /**
   * `cms` — a menu item's page target, and (feature 168) its localised name and
   * URL in the served language.
   */
  readonly pages: Pick<CmsPageReadPort, 'findById' | 'findStorefrontLinks'>;
  /** `cms` — a menu item's block target, and the tree a panel inlines. */
  readonly blocks: Pick<CmsBlockReadPort, 'findById' | 'findLocalizedById'>;
  /**
   * `assets_library` — the stored kind, which is what an item's target declares,
   * whether the caller may see the asset at all (feature 166, FR-006), and its
   * URL. `AssetRecord` carries no resolved URL, so the URL is a second read:
   * `resolveUrls`, the URL `getAsset` would carry without the detail's "used by"
   * walk over every page, block and menu (issue #685).
   */
  readonly assets: Pick<AssetReadPort, 'findById' | 'visibleToCaller' | 'resolveUrls'>;
  /** `customer_accounts` (feature 168) — the groups an audience names, checked on save. */
  readonly customerGroups: Pick<CustomerGroupReadPort, 'findByIds'>;
  /** `customer_accounts` (feature 168) — a signed-in buyer's own customer group. */
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
  /** `organizations` (feature 168) — the buyer's organisation's customer group. */
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
}

/**
 * Who is looking at the menu (feature 168, FR-018).
 *
 * A signed-in **customer** is the only signed-in viewer: an API key or an admin
 * reading the storefront API is not shopping in a session, so it sees what a
 * guest sees — the narrowest answer for every audience but `guests`, which
 * names nothing a key could not read on the public page anyway.
 *
 * The customer's group is read only when `needsGroup` — a menu that names no
 * customer group costs a signed-in request no read. It is
 * `effectiveCustomerGroupId`, the one rule pricing applies (plan R-5).
 */
export async function resolveMenuViewer(
  ports: Pick<MegamenuCrossModulePorts, 'customerAccounts' | 'organizations'>,
  audience: ProductAudience,
  needsGroup: boolean,
): Promise<MenuViewer> {
  const customerAccountId = audience.customerAccountId ?? null;
  if (!audience.authenticated || customerAccountId === null) return { signedIn: false, customerGroupId: null };
  if (!needsGroup) return { signedIn: true, customerGroupId: null };
  const [customer, organization] = await Promise.all([
    ports.customerAccounts.findById(customerAccountId),
    audience.organizationId ? ports.organizations.findById(audience.organizationId) : Promise.resolve(null),
  ]);
  return { signedIn: true, customerGroupId: effectiveCustomerGroupId({ customer, organization }) };
}

/** What a menu item renders an asset target or an icon as. */
export interface MegamenuAssetTarget {
  url: string;
  label: string | null;
  kind: MegamenuAssetKind;
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
 * **No `catch` around the URL read, deliberately.** An asset deleted between the
 * two reads is simply absent from its answer, and a `catch` would also swallow
 * `ModuleDisabledError`, which is the fail-open composition checklist item 7
 * refuses. Neither root caught here either.
 */
export async function resolveMenuAsset(
  ports: Pick<MegamenuCrossModulePorts, 'assets'>,
  assetId: string,
): Promise<MegamenuAssetTarget | null> {
  const record = await ports.assets.findById(assetId);
  if (!record) return null;
  if (record.kind !== 'image' && record.kind !== 'video') return null;

  // D-223 — the URL arrives absolute; the module that built it is the only party
  // that knows which adapter produced it and whether it is signed.
  const url = (await ports.assets.resolveUrls([assetId])).get(assetId);
  return url ? { url, label: record.label, kind: record.kind } : null;
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
