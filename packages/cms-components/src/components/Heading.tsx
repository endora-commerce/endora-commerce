'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { HeadingLevel, HeadingProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
  TEXT_TYPOGRAPHY_FIELDS,
} from '../fields/shared-fields.js';
import {
  editingTypographyStyle,
  hasCustomFontSize,
  HEADING_DEFAULT_SIZE_PX,
  responsiveTypographyVars,
  typographyStyle,
} from './typography.js';

function normalizeHeadingLevel(level: unknown): HeadingLevel {
  if (typeof level === 'string' && /^h[1-6]$/.test(level)) {
    return level as HeadingLevel;
  }
  if (typeof level === 'number' && level >= 1 && level <= 6) {
    return `h${level}` as HeadingLevel;
  }
  return 'h2';
}

function resolveHeadingAlign(props: HeadingProps) {
  return props.textAlign ?? props.align;
}

function headingDefaults(level: HeadingLevel) {
  return {
    fontSize: HEADING_DEFAULT_SIZE_PX[level],
    fontWeight: 700,
    lineHeight: 1.12,
  };
}

const HeadingEditingRender: PuckComponent<HeadingProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const { level, text, ...box } = props;
  const Tag = normalizeHeadingLevel(level);
  const resolvedAlign = resolveHeadingAlign(props);
  const alignAttrs = textAlignDataAttrs(resolvedAlign, 'left');
  const defaults = headingDefaults(Tag);
  const useResponsiveSize = hasCustomFontSize(props.fontSize);

  return (
    <BoxStyled previewTier={tier} {...box}>
      <Tag
        className={`cmsc:font-sans cmsc:m-0 cmsc:text-[#15202b] cmsc:font-bold cmsc-pb-text-align ${useResponsiveSize ? 'cmsc-pb-text-size cmsc-pb-text-weight cmsc-pb-text-leading' : ''}`}
        style={{
          ...typographyStyle({
            ...(props.fontFamily !== undefined ? { fontFamily: props.fontFamily } : {}),
            ...(props.fontStyle !== undefined ? { fontStyle: props.fontStyle } : {}),
            color: props.color,
          }),
          ...(useResponsiveSize
            ? editingTypographyStyle(props, tier, defaults)
            : {
                fontSize: `${defaults.fontSize}px`,
                fontWeight: defaults.fontWeight,
                lineHeight: defaults.lineHeight,
              }),
          textAlign: resolveTextAlignForTier(resolvedAlign, tier, 'left'),
        }}
        {...alignAttrs}
      >
        {text}
      </Tag>
    </BoxStyled>
  );
};

const HeadingPublishedRender: PuckComponent<HeadingProps> = (props) => {
  const { level, text, ...box } = props;
  const Tag = normalizeHeadingLevel(level);
  const resolvedAlign = resolveHeadingAlign(props);
  const alignAttrs = textAlignDataAttrs(resolvedAlign, 'left');
  const defaults = headingDefaults(Tag);
  const useResponsiveSize = hasCustomFontSize(props.fontSize);

  return (
    <BoxStyled {...box}>
      <Tag
        className={`cmsc:font-sans cmsc:m-0 cmsc:text-[#15202b] cmsc:font-bold ${responsiveTextAlignClass(resolvedAlign, 'left')} ${useResponsiveSize ? 'cmsc-pb-text-size cmsc-pb-text-weight cmsc-pb-text-leading' : ''}`}
        style={{
          ...(useResponsiveSize ? responsiveTypographyVars(props, defaults) : {}),
          ...typographyStyle({
            ...(props.fontFamily !== undefined ? { fontFamily: props.fontFamily } : {}),
            ...(props.fontStyle !== undefined ? { fontStyle: props.fontStyle } : {}),
            color: props.color,
          }),
          ...(!useResponsiveSize
            ? {
                fontSize: `${defaults.fontSize}px`,
                fontWeight: defaults.fontWeight,
                lineHeight: defaults.lineHeight,
              }
            : {}),
        }}
        {...alignAttrs}
      >
        {text}
      </Tag>
    </BoxStyled>
  );
};

const headingConfig: ComponentConfig<{ props: HeadingProps }> = {
  label: 'Heading',
  fields: {
    level: {
      type: 'select',
      label: 'Level',
      options: [
        { label: 'H1', value: 'h1' },
        { label: 'H2', value: 'h2' },
        { label: 'H3', value: 'h3' },
        { label: 'H4', value: 'h4' },
        { label: 'H5', value: 'h5' },
        { label: 'H6', value: 'h6' },
      ],
    },
    text: { type: 'textarea', label: 'Text', contentEditable: true },
    ...TEXT_TYPOGRAPHY_FIELDS,
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    level: 'h2',
    text: 'Section heading',
    fontFamily: 'sans',
    fontStyle: 'normal',
    color: '#15202b',
    fontWeight: 700,
    textAlign: 'left',
    lineHeight: 1.12,
    ...DEFAULT_BOX_PROPS,
  },
  resolveData: async ({ props }) => {
    if (props.align !== undefined && props.textAlign === undefined) {
      return { props: { ...props, textAlign: props.align } };
    }
    return { props };
  },
  render: (props) =>
    props.puck?.isEditing ? <HeadingEditingRender {...props} /> : <HeadingPublishedRender {...props} />,
};

export const Heading = withHideOn(headingConfig);
