'use client';

import type { ComponentConfig } from '@puckeditor/core';
import { createFormPickerField } from '@endora-commerce/page-builder-admin';

/**
 * `specs/170-forms-module/` contracts/blocks-and-storefront.md §6 (FR-004, US2-2) — the admin's
 * fields of `forms.Form` (declared by `forms`, rendered from `cms-components`): the form is picked
 * from the forms the editor may see, with a shortcut to create one, instead of typed as an id.
 * Every other field — the presets — and the order of the fields are the block's own.
 *
 * `cms` gains no dependency on `forms`: the picker reads `forms`' admin list over HTTP, as the
 * newsletter pickers read the newsletter's, and the block is offered only while `forms` is present.
 */

/** The block this file gives its picker to. */
export const FORM_BLOCK_FIELDS_BLOCK = 'forms.Form';

// Stable: a field recreated on every merge loses its input focus.
const FORM_PICKER_FIELD = createFormPickerField('Form');

/** `config` with the form picker in `formId`. */
export function withAdminFormBlockFields(config: ComponentConfig): ComponentConfig {
  const fields = { ...(config.fields ?? {}) } as Record<string, unknown>;
  if ('formId' in fields) fields['formId'] = FORM_PICKER_FIELD;
  return { ...config, fields } as ComponentConfig;
}
