// Legacy locator resolver — handles Asset rows whose `storage_backend='legacy'`
// because their pre-013 `storage_url` was an absolute URL we don't own. The
// runtime serves their URLs verbatim for `public`; refuses to flip them to
// `private` (we cannot sign a URL we didn't issue). See research.md R11.

import type {
  StorageResolveUrlInput,
  StorageResolveUrlOutput,
} from './storage-adapter.js';
import { LegacyAssetCannotHardenError } from './errors.js';

export const legacyAssetResolver = {
  resolveUrl(input: StorageResolveUrlInput): StorageResolveUrlOutput {
    if (input.visibility === 'private') {
      throw new LegacyAssetCannotHardenError();
    }
    return { url: input.locator, expiresAt: null };
  },
};
