'use client';

import type { ComponentConfig } from '@puckeditor/core';
import { createNewsletterCustomFieldField, createNewsletterTagCodeField } from '@endora-commerce/page-builder-admin';

/**
 * `specs/169-page-builder-contact-form/` US7, FR-024, FR-025, research R-11 —
 * the admin's fields of `newsletter.Signup` (declared by `newsletter`,
 * rendered from `cms-components`): a topic's tag is picked from the
 * newsletter's tags, an attribute's custom field from its custom fields. The
 * custom-field picker writes the attribute's key, type and label together, so
 * the package's own type select leaves the item; every other field, and the
 * order of the fields, is the block's own.
 *
 * Without `newsletter:read`, or with the module off, the pickers are the text
 * boxes of before (and a type select), so a stored block opens as it was.
 */

/** The block this file gives its pickers to. */
export const NEWSLETTER_SIGNUP_FIELDS_BLOCK = 'newsletter.Signup';

// Stable: a field recreated on every merge loses its input focus.
const TAG_CODE_FIELD = createNewsletterTagCodeField('Newsletter tag code');
const CUSTOM_FIELD_FIELD = createNewsletterCustomFieldField('Custom field');

type FieldMap = Record<string, unknown>;
type Composite = { type?: string; arrayFields?: FieldMap };

function withItemFields(fields: FieldMap, name: string, apply: (arrayFields: FieldMap) => FieldMap): FieldMap {
  const list = fields[name] as Composite | undefined;
  if (list?.type !== 'array' || !list.arrayFields) return fields;
  return { ...fields, [name]: { ...list, arrayFields: apply(list.arrayFields) } };
}

/** `config` with the newsletter pickers in `topics[].tagCode` and `attributes[].key`. */
export function withAdminNewsletterSignupFields(config: ComponentConfig): ComponentConfig {
  let fields: FieldMap = { ...(config.fields ?? {}) };
  fields = withItemFields(fields, 'topics', (item) => ('tagCode' in item ? { ...item, tagCode: TAG_CODE_FIELD } : item));
  fields = withItemFields(fields, 'attributes', (item) => {
    if (!('key' in item)) return item;
    const { type: _type, ...rest } = item;
    return Object.fromEntries(Object.entries(rest).map(([key, field]) => [key, key === 'key' ? CUSTOM_FIELD_FIELD : field]));
  });
  return { ...config, fields } as ComponentConfig;
}
