'use client';

import { isValidElement, type ReactNode } from 'react';
import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import {
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { TextProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
  TEXT_TYPOGRAPHY_FIELDS,
} from '../fields/shared-fields.js';
import { resolveTextContent, type LegacyTextSource } from './text-content.js';
import { editingTypographyStyle, responsiveTypographyVars, typographyStyle } from './typography.js';
import { InlineRich } from './InlineRich.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { textMaxWidthAttrs, textMaxWidthFields, usesCustomTextMaxWidth } from './text-max-width.js';

const TEXT_DEFAULTS = { fontSize: 16, fontWeight: 400, lineHeight: 1.65 };

/**
 * In the editor, Puck's contentEditable transform replaces string `text` with an
 * InlineTextField React node. That must be rendered as-is — resolveTextContent()
 * would coerce it to '' and leave the canvas stuck on legacy/html fallback.
 */
function resolveEditingTextContent(props: LegacyTextSource) {
  const { text, html, tiptapContent } = props;
  // R19A (T232): an inline rich text renders its runs (on the canvas it arrives as its in-place editor, below).
  if (isInlineRichDoc(text)) return <InlineRich value={text as never} />;
  if (typeof text !== 'string' && text != null) {
    return text as ReactNode;
  }
  return resolveTextContent({ text, html, tiptapContent }) || 'Body copy';
}

const TextEditingRender: PuckComponent<TextProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const { text, html, tiptapContent, textAlign, ...box } = props;
  const resolvedText = resolveEditingTextContent({ text, html, tiptapContent });
  const alignAttrs = textAlignDataAttrs(textAlign, 'left');
  const measure = textMaxWidthAttrs(props, tier);
  const editingAlign = resolveTextAlignForTier(textAlign, tier, 'left');

  return (
    <BoxStyled previewTier={tier} {...box}>
      <p
        className={`cmsc:m-0 cmsc:whitespace-pre-wrap cmsc-pb-text-align${measure ? ` ${measure.className}` : ''}`}
        style={{
          ...(measure
            ? {
                ...measure.style,
                ...(editingAlign === 'center' ? { marginLeft: 'auto', marginRight: 'auto' } : {}),
                ...(editingAlign === 'right' ? { marginLeft: 'auto' } : {}),
              }
            : {}),
          ...editingTypographyStyle(props, tier, TEXT_DEFAULTS),
          ...typographyStyle({
            ...(props.fontFamily !== undefined ? { fontFamily: props.fontFamily } : {}),
            ...(props.fontStyle !== undefined ? { fontStyle: props.fontStyle } : {}),
            color: props.color,
          }),
          textAlign: resolveTextAlignForTier(textAlign, tier, 'left'),
        }}
        {...alignAttrs}
      >
        {resolvedText}
      </p>
    </BoxStyled>
  );
};

/**
 * R19A (T232): a text stored as inline rich text (a one-paragraph document) —
 * bold, italic, links, emphasis — rather than a plain string. A plain string,
 * as every text stored before, keeps today's path and markup.
 */
function isInlineRichDoc(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !isValidElement(value) && (value as { type?: unknown }).type === 'doc';
}

const TextPublishedRender: PuckComponent<TextProps> = (props) => {
  const { text, html, tiptapContent, textAlign, ...box } = props;
  const resolvedText = isInlineRichDoc(text) ? <InlineRich value={text as never} /> : resolveTextContent({ text, html, tiptapContent });
  const alignAttrs = textAlignDataAttrs(textAlign, 'left');
  const measure = textMaxWidthAttrs(props, null);

  return (
    <BoxStyled {...box}>
      <p
        className={`cmsc:m-0 cmsc:whitespace-pre-wrap cmsc-pb-text-size cmsc-pb-text-weight cmsc-pb-text-leading ${responsiveTextAlignClass(textAlign, 'left')}${measure ? ` ${measure.className}` : ''}`}
        style={{
          ...(measure?.style ?? {}),
          ...responsiveTypographyVars(props, TEXT_DEFAULTS),
          ...typographyStyle({
            ...(props.fontFamily !== undefined ? { fontFamily: props.fontFamily } : {}),
            ...(props.fontStyle !== undefined ? { fontStyle: props.fontStyle } : {}),
            color: props.color,
          }),
        }}
        {...alignAttrs}
      >
        {resolvedText}
      </p>
    </BoxStyled>
  );
};

const TEXT_FIELDS: NonNullable<ComponentConfig<{ props: TextProps }>['fields']> = {
  // R19A (T232): inline rich text (bold, italic, links, emphasis), typed on the canvas as before; a stored string reads as one paragraph.
  text: createInlineRichTextField({ label: 'Text', canvas: true }) as never,
  ...TEXT_TYPOGRAPHY_FIELDS,
  // T134: a maximum width for the text, per breakpoint; unset keeps today's full width.
  ...textMaxWidthFields(),
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const textConfig: ComponentConfig<{ props: TextProps }> = {
  label: 'Simple text',
  fields: TEXT_FIELDS,
  defaultProps: {
    text: 'Body copy',
    fontFamily: 'sans',
    fontStyle: 'normal',
    // R17 (T216): no colour of its own — a new text follows the section's (a stored one keeps its colour).
    fontSize: 16,
    fontWeight: 400,
    textAlign: 'left',
    lineHeight: 1.65,
    ...DEFAULT_BOX_PROPS,
  },
  // The Custom px is offered once a tier of the measure is on Custom.
  resolveFields: (data, params) => {
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(params?.fields ?? TEXT_FIELDS)) {
      if (key === 'textMaxWidthPx' && !usesCustomTextMaxWidth(data.props.textMaxWidth)) continue;
      fields[key] = field;
    }
    return fields as never;
  },
  // Puck widens the stored document's one-paragraph tuple to an array; the props are the stored shape.
  resolveData: async ({ props }) => {
    const stored = props as unknown as TextProps;
    // R19A (T232): an inline rich text is the text itself; nothing is carried.
    if (isInlineRichDoc(stored.text)) return { props: stored };
    const resolved = resolveTextContent(stored);
    const hasDirectText = typeof stored.text === 'string' && stored.text.trim().length > 0;
    if (!hasDirectText && resolved && (stored.tiptapContent || stored.html)) {
      return {
        props: {
          ...stored,
          text: resolved,
        },
      };
    }
    return { props: stored };
  },
  render: (props) =>
    props.puck?.isEditing ? <TextEditingRender {...props} /> : <TextPublishedRender {...props} />,
};

export const Text = withHideOn(textConfig);
