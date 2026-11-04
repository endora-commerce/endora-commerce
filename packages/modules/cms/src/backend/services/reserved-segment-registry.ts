import type { CmsReservedSegmentContributor, CmsReservedSegmentRegistryPort } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';

/**
 * Feature 171 (`specs/171-blog-i18n-authors/` research R5) — the first segments other
 * modules serve on the storefront, per channel. The page service refuses a slug that
 * starts with one, as it refuses a language prefix (feature 167).
 *
 * A contributor whose module is switched off claims nothing: its address is not
 * served then, and a page may take it (Constitution XVII).
 */
export class CmsReservedSegmentRegistry implements CmsReservedSegmentRegistryPort {
  readonly #contributors: CmsReservedSegmentContributor[] = [];

  register(contributor: CmsReservedSegmentContributor): void {
    this.#contributors.push(contributor);
  }

  /** Every claimed segment of the given channels → the module claiming it. */
  async claimedIn(salesChannelIds: readonly string[]): Promise<Map<string, string>> {
    const claimed = new Map<string, string>();
    for (const contributor of this.#contributors) {
      if (!effectiveState.isPresent(contributor.contributorModuleId)) continue;
      for (const channelId of salesChannelIds) {
        for (const segment of await contributor.segmentsFor(channelId)) {
          if (!claimed.has(segment.toLowerCase())) claimed.set(segment.toLowerCase(), contributor.contributorModuleId);
        }
      }
    }
    return claimed;
  }
}
