'use client';

import { lazy, Suspense, type ReactElement } from 'react';
import { FieldLabel, type CustomField } from '@puckeditor/core';
import type { JSONContent } from '@tiptap/core';
import { EditorLoading } from './editor-loading.js';

/**
 * The editor is loaded on demand: a block's field map is imported wherever the
 * block's config is (the storefront included), and only the admin canvas ever
 * renders a field.
 */
const LazyRichContentEditorField = lazy(async () => {
  const mod = await import('../components/RichContentEditorField.js');
  return { default: mod.RichContentEditorField };
});

/** An empty document, so an unset field opens blank rather than on `RichContent`'s sample text. */
const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * A rich-text field storing a TipTap document — the `RichContent` block's editor
 * as a field of another block (a hero's `body`; `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, translated with `format: 'tiptap'`).
 */
export function createRichTextDocField(options: { label: string }): CustomField<JSONContent | null | undefined> {
  return {
    type: 'custom',
    label: options.label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldLabel label={field.label ?? options.label} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
        <Suspense fallback={<EditorLoading />}>
          <LazyRichContentEditorField
            value={value ?? EMPTY_DOC}
            onChange={onChange}
            {...(readOnly === true ? { readOnly: true } : {})}
          />
        </Suspense>
      </FieldLabel>
    ),
  };
}
