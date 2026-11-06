'use client';

import { lazy, Suspense, type ReactElement } from 'react';
import { type ComponentConfig } from '@puckeditor/core';
import type { JSONContent } from '@tiptap/core';
import type { RichContentProps } from '../schema/component-types.js';
import { BOX_BORDER_FIELD, BOX_MARGIN_FIELD, BOX_PADDING_FIELD, DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';
import { RichContentEditingPreviewRender, RichContentPublishedRender } from './RichContentPublished.js';
import { coerceRichContentProps, defaultRichContent, htmlFromTiptap } from './rich-content-shared.js';
import { textMaxWidthFields, usesCustomTextMaxWidth } from './text-max-width.js';
import { sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';
import { createColorField } from '@endora-commerce/page-builder-core';
import { textWeightField } from './typography.js';
import { lineHeightField, sizeUsesCustom } from './text-style.js';

const LazyRichContentEditorField = lazy(async () => {
  const mod = await import('./RichContentEditorField.js');
  return { default: mod.RichContentEditorField };
});

function RichContentFieldRender({
  value,
  onChange,
  readOnly,
}: {
  value: JSONContent | null | undefined;
  onChange: (value: JSONContent | null) => void;
  readOnly?: boolean;
}): ReactElement {
  return (
    <Suspense fallback={<p className="text-sm opacity-70">Loading editor…</p>}>
      <LazyRichContentEditorField
        value={value ?? null}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
    </Suspense>
  );
}

type RichContentFields = NonNullable<ComponentConfig<RichContentProps>['fields']>;

const MEASURE_FIELDS = textMaxWidthFields() as unknown as Pick<RichContentFields, 'textMaxWidth' | 'textMaxWidthPx'>;

const SIZE_FIELDS = {
  textSize: sizeFieldWithDefault('Text size'),
  textSizePx: sizePxField('Custom text size (px)'),
} as unknown as Pick<RichContentFields, 'textSize' | 'textSizePx'>;

const LIST_FIELDS = { listLineHeight: lineHeightField('List line height') } as unknown as Pick<RichContentFields, 'listLineHeight'>;

// R22I (T377): the text's weight; Default keeps today's. R23 (T435): one value, and the lists follow it.
const WEIGHT_FIELDS = {
  textWeight: textWeightField('Text weight'),
} as unknown as Pick<RichContentFields, 'textWeight'>;

const RICH_CONTENT_FIELDS = {
  content: {
    type: 'custom',
    label: 'Content',
    render: ({ value, onChange, readOnly }) => (
      <RichContentFieldRender
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
    ),
  },
  // `html` is kept on props (synced from TipTap in resolveData) for published
  // render + legacy trees, but is not an author-facing field.
  // R19A (T233): the text's size per breakpoint (a type token or Custom px); Default keeps today's body size.
  ...SIZE_FIELDS,
  textWeight: WEIGHT_FIELDS.textWeight,
  // R20E (T307): the check and chevron markers' colour; unset keeps today's (the brand's primary tick).
  listMarkerColor: createColorField({ label: 'List marker color' }),
  // R21G (T338): the lists' line height per breakpoint; empty keeps the text's. R23: with a Custom px size only.
  ...LIST_FIELDS,
  // T134: a maximum width for the text, per breakpoint; unset keeps today's full width.
  ...MEASURE_FIELDS,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
} as RichContentFields;

export const RichContent: ComponentConfig<RichContentProps> = {
  label: 'Rich content',
  fields: RICH_CONTENT_FIELDS,
  // The Custom px is offered once a tier of the measure is on Custom.
  resolveFields: (data, params) => {
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(params?.fields ?? RICH_CONTENT_FIELDS)) {
      if (key === 'textMaxWidthPx' && !usesCustomTextMaxWidth(data.props.textMaxWidth)) continue;
      if (key === 'textSizePx' && !usesCustomTextMaxWidth(data.props.textSize)) continue;
      if (key === 'listLineHeight' && !sizeUsesCustom(data.props.textSize)) continue;
      fields[key] = field;
    }
    return fields as RichContentFields;
  },
  defaultProps: {
    content: defaultRichContent,
    html: '',
    ...DEFAULT_BOX_PROPS,
  },
  resolveData: async ({ props }, { changed }) => {
    const normalized = coerceRichContentProps(props);
    if (changed.content) {
      return {
        props: {
          ...normalized,
          html: htmlFromTiptap(normalized.content) || normalized.html,
        },
      };
    }
    return { props: normalized };
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <RichContentEditingPreviewRender {...props} />
    ) : (
      <RichContentPublishedRender {...props} />
    ),
};
