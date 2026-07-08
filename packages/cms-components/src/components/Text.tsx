'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { TextProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
  TEXT_TYPOGRAPHY_FIELDS,
} from '../fields/shared-fields.js';
import { resolveTextContent } from './text-content.js';
import { editingTypographyStyle, responsiveTypographyVars, typographyStyle } from './typography.js';

const TEXT_DEFAULTS = { fontSize: 16, fontWeight: 400, lineHeight: 1.65 };

const TextEditingRender: PuckComponent<TextProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const { text, html, tiptapContent, textAlign, ...box } = props;
  const resolvedText = resolveTextContent({ text, html, tiptapContent });
  const alignAttrs = textAlignDataAttrs(textAlign, 'left');

  return (
    <BoxStyled previewTier={tier} {...box}>
      <p
        className="cmsc:m-0 cmsc:whitespace-pre-wrap cmsc-pb-text-align"
        style={{
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
        {resolvedText || 'Body copy'}
      </p>
    </BoxStyled>
  );
};

const TextPublishedRender: PuckComponent<TextProps> = (props) => {
  const { text, html, tiptapContent, textAlign, ...box } = props;
  const resolvedText = resolveTextContent({ text, html, tiptapContent });
  const alignAttrs = textAlignDataAttrs(textAlign, 'left');

  return (
    <BoxStyled {...box}>
      <p
        className={`cmsc:m-0 cmsc:whitespace-pre-wrap cmsc-pb-text-size cmsc-pb-text-weight cmsc-pb-text-leading ${responsiveTextAlignClass(textAlign, 'left')}`}
        style={{
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

const textConfig: ComponentConfig<{ props: TextProps }> = {
  label: 'Simple Text',
  fields: {
    text: { type: 'textarea', label: 'Text', contentEditable: true },
    ...TEXT_TYPOGRAPHY_FIELDS,
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    text: 'Body copy',
    fontFamily: 'sans',
    fontStyle: 'normal',
    color: '#243447',
    fontSize: 16,
    fontWeight: 400,
    textAlign: 'left',
    lineHeight: 1.65,
    ...DEFAULT_BOX_PROPS,
  },
  resolveData: async ({ props }) => {
    const resolved = resolveTextContent(props);
    const hasDirectText = typeof props.text === 'string' && props.text.trim().length > 0;
    if (!hasDirectText && resolved && (props.tiptapContent || props.html)) {
      return {
        props: {
          ...props,
          text: resolved,
        },
      };
    }
    return { props };
  },
  render: (props) =>
    props.puck?.isEditing ? <TextEditingRender {...props} /> : <TextPublishedRender {...props} />,
};

export const Text = withHideOn(textConfig);
