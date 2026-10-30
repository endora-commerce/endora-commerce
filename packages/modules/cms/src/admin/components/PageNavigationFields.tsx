'use client';

import type { ComponentConfig } from '@puckeditor/core';
import { createAnchorField } from '@endora-commerce/page-builder-admin';

/**
 * Feature 169, T058 (`specs/169-page-builder-contact-form/` FR-014,
 * contracts/blocks.md §3) — in the admin, each link of `cms.PageNavigation`
 * picks its anchor from the sections of the page as it is now, or takes free
 * text normalised to the anchor grammar: the link field's anchor control
 * (`createAnchorField`). Every other field, and their order, is the block's own.
 */

// Stable: a field recreated on every merge loses its input focus.
const ANCHOR_FIELD = createAnchorField('Section anchor');

type FieldMap = Record<string, unknown>;
type Composite = { type?: string; arrayFields?: FieldMap };

const SWAPS: Record<string, (fields: FieldMap) => FieldMap> = {
  'cms.PageNavigation': (fields) => {
    const items = fields['items'] as Composite | undefined;
    if (items?.type !== 'array' || !items.arrayFields || !('anchor' in items.arrayFields)) return fields;
    return { ...fields, items: { ...items, arrayFields: { ...items.arrayFields, anchor: ANCHOR_FIELD } } };
  },
};

/** The blocks this module gives the anchor picker to. */
export const PAGE_NAVIGATION_BLOCKS_WITH_ADMIN_FIELDS: readonly string[] = Object.keys(SWAPS);

/** `config` with the admin's anchor picker, when `name` is one of {@link PAGE_NAVIGATION_BLOCKS_WITH_ADMIN_FIELDS}; any other block as it is. */
export function withAdminPageNavigationFields(name: string, config: ComponentConfig): ComponentConfig {
  const apply = SWAPS[name];
  if (!apply) return config;
  return { ...config, fields: apply({ ...(config.fields ?? {}) }) } as ComponentConfig;
}
