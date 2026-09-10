// Legacy locator resolver — handles Asset rows whose `storage_backend='legacy'`
// because their pre-013 `storage_url` was a URL we don't own. The runtime serves
// their URLs verbatim for `public`; refuses to flip them to `private` (we cannot
// sign a URL we didn't issue). See research.md R11.
//
// **Verbatim, but absolute** (D-223). A legacy row that carries a full URL is
// passed through untouched; one that carries a host-relative path — the shape
// the composition root's `absolutizePublicUrl` used to rescue for two of its
// four consumers and not for the other two — is rebased here, so the answer no
// longer depends on which root composed the platform.

import type {
  StorageResolveUrlInput,
  StorageResolveUrlOutput,
} from './storage-adapter.js';
import { LegacyAssetCannotHardenError } from './errors.js';
import { absolutizeAssetUrl } from './public-url-base.js';

export interface LegacyAssetResolver {
  resolveUrl(input: StorageResolveUrlInput): StorageResolveUrlOutput;
}

/**
 * Build the resolver for `storage_backend='legacy'` rows on this deployment's
 * public API origin.
 *
 * A factory rather than the module-level constant it used to be, for the same
 * reason every adapter in this directory takes the origin at construction: the
 * origin is a deployment fact, and a URL builder that cannot see it is a URL
 * builder whose answer is relative.
 */
export function createLegacyAssetResolver(publicApiBaseUrl: string): LegacyAssetResolver {
  return {
    resolveUrl(input: StorageResolveUrlInput): StorageResolveUrlOutput {
      if (input.visibility === 'private') {
        throw new LegacyAssetCannotHardenError();
      }
      return { url: absolutizeAssetUrl(input.locator, publicApiBaseUrl), expiresAt: null };
    },
  };
}
