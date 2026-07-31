/** Minimum time catalog skeletons stay visible so loading state is perceptible on fast/local APIs. */
export const CATALOG_SKELETON_MIN_MS = 320;

export async function waitForCatalogSkeletonMin(startedAt: number): Promise<void> {
  const remaining = CATALOG_SKELETON_MIN_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, remaining);
    });
  }
}
