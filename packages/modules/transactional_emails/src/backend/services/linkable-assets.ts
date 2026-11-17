import { contentAssetIds, ERROR_CODES, unlinkableAssetIds, type AssetReadPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** The one question this module asks `assets_library` before it stores an asset id. */
export type EmailAssetVisibility = Pick<AssetReadPort, 'visibleToCaller'>;

const NOTHING_VISIBLE: EmailAssetVisibility = { visibleToCaller: async () => new Set() };

/**
 * Issue #1354, the `transactional_emails` half of #544 (owner ruling
 * 2026-10-30, option a) — refuse a save that newly adds an asset id the caller
 * may not see in the asset library, a missing id included, with the answer
 * `assets_library` gives for a hidden file.
 *
 * An e-mail block, template or e-mail body is rendered into every message
 * sent, so a hidden file's id stored in one would reach every recipient. The
 * ids are read by `contentAssetIds` — string values under keys ending in
 * `assetId`, the rule the e-mail renderer resolves embeds by.
 *
 * `current` holds what the record already stores: an id in it is that
 * record's own reference and is accepted, so a body still embedding a purged
 * file saves as before.
 *
 * `assets` is optional only so fixtures without the library keep constructing
 * the services; a save that adds an id without it fails closed.
 */
export async function assertEmailAssetsLinkable(
  assets: EmailAssetVisibility | undefined,
  proposed: unknown,
  current: readonly unknown[],
): Promise<void> {
  const stored = new Set<string>();
  for (const tree of current) contentAssetIds(tree, stored);
  const [refused] = await unlinkableAssetIds(assets ?? NOTHING_VISIBLE, contentAssetIds(proposed), stored);
  if (refused === undefined) return;
  if (!assets) {
    throw new Error('transactional_emails: the asset read port is not wired — an asset id cannot be stored.');
  }
  throw assetNotLinkable(refused);
}

/** The answer for an asset id that cannot be stored — `assets_library`'s own for a hidden file. */
export function assetNotLinkable(assetId: string): HttpError {
  return new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`, { assetId });
}
