// Editor fields derived from a block's manifest declaration (plan D8, FR-014).
//
// What makes a declared block with no contributed editor renderer editable: an
// overlay module's block (no admin layer), or a block whose module the admin
// build is one version behind. A module that wants a picker in place of a text
// input contributes it and overrides the derived field by key.

import type { CustomField, Field, Fields } from '@puckeditor/core';
import type { CmsFieldDescriptor } from '@endora-commerce/contracts/cms';
import { createElement, type ReactElement } from 'react';

/** The part of a served descriptor entry the derivation reads. */
export interface DescriptorFieldSource {
  readonly fields: Readonly<Record<string, CmsFieldDescriptor>>;
}

/**
 * A structured value edited as JSON.
 *
 * A declaration says a field is an `array` or an `object` and does not say of
 * what, so there are no sub-fields to render. JSON is the editor that loses
 * nothing: the stored value round-trips byte for byte until the operator
 * types something that parses.
 */
function jsonField(label: string): CustomField<unknown> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, id, readOnly }): ReactElement =>
      createElement(
        'label',
        { htmlFor: id, style: { display: 'block' } },
        createElement('span', { style: { display: 'block', marginBottom: 4 } }, label),
        createElement('textarea', {
          id,
          rows: 6,
          readOnly: readOnly === true,
          spellCheck: false,
          style: { width: '100%', fontFamily: 'monospace', fontSize: 12 },
          defaultValue: value === undefined ? '' : JSON.stringify(value, null, 2),
          onChange: (event: { target: { value: string } }) => {
            const text = event.target.value;
            if (text.trim() === '') {
              onChange(undefined);
              return;
            }
            try {
              onChange(JSON.parse(text) as unknown);
            } catch {
              // Not JSON yet: keep the last value that parsed rather than
              // storing half a document.
            }
          },
        }),
      ),
  };
}

function fieldFor(key: string, descriptor: CmsFieldDescriptor): Field {
  const label = descriptor.label ?? key;
  const options = descriptor.options ?? [];
  switch (descriptor.type) {
    case 'textarea':
    // Rich text is stored as an HTML string by the blocks that declare it; a
    // textarea edits that string without choosing an editor on the module's
    // behalf.
    case 'richtext':
      return { type: 'textarea', label };
    case 'number':
      return { type: 'number', label };
    case 'select':
      return options.length > 0 ? { type: 'select', label, options } : { type: 'text', label };
    case 'radio':
      return options.length > 0 ? { type: 'radio', label, options } : { type: 'text', label };
    case 'array':
    case 'object':
      return jsonField(label);
    // A reference is an identifier until the owning module contributes the
    // picker that knows what it refers to.
    case 'external':
    case 'uuid':
    case 'text':
      return { type: 'text', label };
  }
}

/** Puck fields for every field a block's declaration carries, in declared order. */
export function fieldsFromDescriptor(entry: DescriptorFieldSource): Fields {
  const fields: Record<string, Field> = {};
  for (const [key, descriptor] of Object.entries(entry.fields)) {
    fields[key] = fieldFor(key, descriptor);
  }
  return fields as Fields;
}
