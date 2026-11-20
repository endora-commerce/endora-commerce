'use client';

import { lazy, Suspense, type ReactElement } from 'react';
import { FieldLabel, type CustomField } from '@puckeditor/core';
import type { InlineRichText } from '@endora-commerce/page-builder-core';
import { EditorLoading } from './editor-loading.js';

/**
 * The TipTap editor is loaded on demand: a block's field map is imported
 * wherever the block's config is (the storefront included), and only the admin
 * canvas ever renders a field.
 */
const LazyInlineRichTextEditor = lazy(async () => {
  const mod = await import('../components/InlineRichTextEditor.js');
  return { default: mod.InlineRichTextEditor };
});

export interface InlineRichTextFieldOptions {
  label: string;
  /**
   * Also edit the text in place on the editor canvas (feature 163): the field
   * is marked `inlineCanvas`, which `INLINE_RICH_TEXT_FIELD_TRANSFORMS`
   * (`editor/inline-rich-text-canvas`) answers. The side-bar field stays.
   */
  canvas?: boolean;
}

/** An inline rich-text field, as `createInlineRichTextField` returns it. */
export type InlineRichTextField = CustomField<InlineRichTextFieldValue> & { inlineCanvas?: true };

/** A stored inline rich-text prop: a document, or a legacy plain string read as one. */
export type InlineRichTextFieldValue = InlineRichText | string | undefined;

/**
 * The field of every short rich heading — a hero's title, subheading and
 * statement, a section heading, a card title
 * (`specs/163-page-builder-marketing-pages/` research R-10). One paragraph with
 * bold, italic, link, a hard break and the three `emphasis` variants; the
 * stored value is an `InlineRichText` document (data-model §3.5).
 */
export function createInlineRichTextField(options: InlineRichTextFieldOptions): InlineRichTextField {
  return {
    type: 'custom',
    label: options.label,
    ...(options.canvas === true ? { inlineCanvas: true as const } : {}),
    render: ({ value, onChange, readOnly, field }): ReactElement => {
      const label = field.label ?? options.label;
      return (
        <FieldLabel label={label} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
          <Suspense fallback={<EditorLoading />}>
            <LazyInlineRichTextEditor
              value={value}
              onChange={onChange}
              label={label}
              {...(readOnly === true ? { readOnly: true } : {})}
            />
          </Suspense>
        </FieldLabel>
      );
    },
  };
}
