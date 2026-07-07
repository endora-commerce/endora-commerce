'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  resolveTextAlignClassForTier,
  responsiveTextAlignClass,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { HeadingLevel, HeadingProps } from '../schema/component-types.js';

function normalizeHeadingLevel(level: unknown): HeadingLevel {
  if (typeof level === 'string' && /^h[1-6]$/.test(level)) {
    return level as HeadingLevel;
  }
  if (typeof level === 'number' && level >= 1 && level <= 6) {
    return `h${level}` as HeadingLevel;
  }
  return 'h2';
}

const sizeClass: Record<HeadingLevel, string> = {
  h1: 'cmsc:text-[48px]',
  h2: 'cmsc:text-[40px]',
  h3: 'cmsc:text-[32px]',
  h4: 'cmsc:text-[26px]',
  h5: 'cmsc:text-[22px]',
  h6: 'cmsc:text-[18px]',
};

const HeadingEditingRender: PuckComponent<HeadingProps> = ({ level, text, align }) => {
  const tier = usePreviewBreakpointTier();
  const Tag = normalizeHeadingLevel(level);
  const className = `cmsc:font-sans cmsc:m-0 cmsc:text-[#15202b] cmsc:leading-[1.12] cmsc:font-bold ${sizeClass[Tag]} ${resolveTextAlignClassForTier(align, tier, 'left')}`;

  return <Tag className={className}>{text}</Tag>;
};

const HeadingPublishedRender: PuckComponent<HeadingProps> = ({ level, text, align }) => {
  const Tag = normalizeHeadingLevel(level);
  const className = `cmsc:font-sans cmsc:m-0 cmsc:text-[#15202b] cmsc:leading-[1.12] cmsc:font-bold ${sizeClass[Tag]} ${responsiveTextAlignClass(align, 'left')}`;

  return <Tag className={className}>{text}</Tag>;
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
    align: {
      type: 'select',
      label: 'Align',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
  },
  defaultProps: {
    level: 'h2',
    text: 'Section heading',
    align: 'left',
  },
  render: (props) =>
    props.puck?.isEditing ? <HeadingEditingRender {...props} /> : <HeadingPublishedRender {...props} />,
};

export const Heading = withHideOn(headingConfig);
