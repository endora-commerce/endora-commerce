import type { AssetReadPort, AssetsLibraryPort } from '@endora-commerce/contracts';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';

/**
 * Everything `pwa` needs from outside itself that is not one of its own rows
 * (`specs/110-instance-repository/` T118c).
 *
 * It replaces `PwaBridge`, which was the same set written as closures in both
 * composition roots — so a composition had to know how an asset id becomes a
 * URL, how a channel id becomes a code and what an order-status push says, and
 * the two roots disagreed about two of the three. What is left is
 * **module-private** and holds two published ports and no closure, so there
 * is nothing for a root to build and nothing for the two of them to differ on.
 * The order-status sentence left this file with
 * `specs/149-pwa-order-status-push/`: it is `status-push-composer.ts`'s now,
 * localised and deep-linked.
 *
 * `backend/index.ts` supplies each one as a `lazyPort` proxy, which resolves per
 * call — nothing here captures a registration, so a switched-off owner refuses
 * at the call rather than through a gate frozen at composition time.
 *
 * The functions below are functions **of the ports** rather than of a
 * `ModuleContext`, which is what lets the mapping be tested over stubs with no
 * container composed (`cross-module-context.test.ts`).
 */
export interface PwaCrossModulePorts {
  /** `assets_library`, for the icon pipeline: the source and rendition uploads. */
  readonly assets: AssetsLibraryPort;
  /** `assets_library` again, for the URL the storefront icon route redirects to. */
  readonly assetReads: Pick<AssetReadPort, 'resolveUrls'>;
  /**
   * The kernel's channel resolver — a platform name, not a module's, so it puts
   * nothing in this module's manifest `dependencies` (Constitution XII).
   */
  readonly channels: SalesChannelResolutionPort;
}

/**
 * How a stored asset id becomes the URL the storefront icon route redirects to.
 *
 * **`resolveUrls`, the read port's** (D-223, issue #685): `assets_library`
 * resolves the public origin itself and every URL it returns is absolute. Both
 * roots used to call `resolveUrl` and one of them used to wrap it in an
 * `absolutizePublicUrl` the other did not; it then read `getAsset`, whose detail
 * walks every page, block and menu for its "used by" list on each call. An icon
 * rendition pointing at a deleted asset is absent from the answer and 404s on
 * that one size rather than 500; with no `catch`, the owner's refusal still
 * answers as itself.
 */
export function createAssetUrlResolver(
  assets: Pick<AssetReadPort, 'resolveUrls'>,
): (assetId: string) => Promise<string | null> {
  return async (assetId) => (await assets.resolveUrls([assetId])).get(assetId) ?? null;
}

/**
 * The channel a settings read or write falls back to when the admin surface
 * names none: the deployment's system default.
 *
 * `null` is still in the return type and is still unreachable through this
 * implementation — D-48 says exactly one row holds the flag on a booted
 * deployment. The seam admits it because {@link PwaCrossModulePorts} is not the
 * only thing that could ever answer, and because the option it feeds
 * (`resolveScopeChannelId`) means "read platform-wide" by it.
 */
export function createDefaultChannelIdResolver(
  channels: Pick<SalesChannelResolutionPort, 'getSystemDefault'>,
): () => Promise<string | null> {
  return async () => (await channels.getSystemDefault()).id;
}

/**
 * A channel id to its code, because a settings subset write is keyed by code.
 *
 * `getById` is the resolver's `em.findOne(SalesChannel, { id })` with a cache
 * populate on the way out — the same read the composition roots wrote by hand,
 * with the same absence of narrowing, so an inactive channel still answers its
 * code and an unknown id still answers `null` (which the admin reset route
 * turns into `PWA_CHANNEL_UNKNOWN`).
 */
export function createChannelCodeResolver(
  channels: Pick<SalesChannelResolutionPort, 'getById'>,
): (channelId: string) => Promise<string | null> {
  return async (channelId) => (await channels.getById(channelId))?.code ?? null;
}
