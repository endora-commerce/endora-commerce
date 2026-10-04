'use client';

/**
 * The storefront layer — React renderers for this module's blocks in the `cms`
 * context, keyed by the persisted block name. The storefront that installs this
 * package discovers the layer from the `exports` map and imports it statically.
 */
import type { StorefrontContributions } from '@endora-commerce/page-builder-core/contributions';

import { Badge } from './Badge.js';

export const contributions: StorefrontContributions = {
  blocks: {
    'acceptance_blocks.Badge': {
      defaultProps: { text: 'New badge', explode: 'no' },
      render: Badge,
    },
  },
};
