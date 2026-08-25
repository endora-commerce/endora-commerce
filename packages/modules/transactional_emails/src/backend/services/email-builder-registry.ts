/**
 * Email page-builder descriptor (feature 047). The admin merges this with the
 * bundled `defaultEmailBuilderConfig` from @endora-commerce/email-components to present an
 * email-safe palette. Names are the single source of truth shared with the
 * renderer and save-time validation.
 */

import { EMAIL_SAFE_COMPONENT_NAMES } from '@endora-commerce/email-components/schema/component-types';
import type { EmailPageBuilderDescriptor } from '@endora-commerce/contracts';

export function describeEmailBuilder(): EmailPageBuilderDescriptor {
  return {
    schemaVersion: 1,
    components: EMAIL_SAFE_COMPONENT_NAMES.map((name) => ({ name })),
  };
}
