import {
  contentAssetIds,
  ERROR_CODES,
  UUID_SHAPE_PATTERN,
  unlinkableAssetIds,
  type AssetReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

const LIBRARY_FILE_URL = new RegExp(`/assets/file/(${UUID_SHAPE_PATTERN})`);

/**
 * Every asset id a document tree makes the renderer read: an `assetId`-style
 * prop, and a library file URL in a `src` prop, which a logo block resolves
 * to the same bytes.
 */
export function documentAssetIds(tree: unknown, acc: Set<string> = new Set()): Set<string> {
  contentAssetIds(tree, acc);
  collectSrcAssetIds(tree, acc);
  return acc;
}

function collectSrcAssetIds(tree: unknown, acc: Set<string>): void {
  if (tree === null || typeof tree !== 'object') return;
  if (Array.isArray(tree)) {
    for (const item of tree) collectSrcAssetIds(item, acc);
    return;
  }
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    if (key === 'src' && typeof value === 'string') {
      const id = LIBRARY_FILE_URL.exec(value)?.[1];
      if (id) acc.add(id);
    } else {
      collectSrcAssetIds(value, acc);
    }
  }
}

/**
 * Issue #544 (owner ruling 2026-10-30, option a) — refuse a tree that names an
 * image the caller may not see in the asset library, a missing one included,
 * with `assets_library`'s own answer for a hidden file. The renderer inlines
 * the bytes into the PDF, the preview included, so a hidden file would reach
 * whoever saves or previews the template.
 *
 * `current` is what the template already stores: an id in it is accepted as
 * it stands, so a template still naming a purged file saves as before. A
 * preview has nothing stored and passes `[]`.
 */
export async function assertDocumentAssetsLinkable(
  assets: Pick<AssetReadPort, 'visibleToCaller'>,
  tree: unknown,
  current: readonly unknown[],
): Promise<void> {
  const stored = new Set<string>();
  for (const content of current) documentAssetIds(content, stored);
  const [refused] = await unlinkableAssetIds(assets, documentAssetIds(tree), stored);
  if (refused === undefined) return;
  throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${refused} not found.`, { assetId: refused });
}
