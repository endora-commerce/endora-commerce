'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  buildResponsiveNumberVars,
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  resolveRowAlignClassForTier,
  responsiveRowAlignClass,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { RowProps } from '../schema/component-types.js';

const RowEditingRender: PuckComponent<RowProps> = ({
  content: Content,
  gap,
  align,
  background,
  padding,
}) => {
  const tier = usePreviewBreakpointTier();

  return (
    <section
      className={`cmsc:flex cmsc:flex-col cmsc:w-full ${resolveRowAlignClassForTier(align, tier, 'stretch')}`}
      style={{
        background,
        gap: `${resolveResponsiveNumber(gap, tier, 24)}px`,
        padding: `${resolveResponsiveNumber(padding, tier, 0)}px`,
      }}
    >
      <Content minEmptyHeight={80} />
    </section>
  );
};

const RowPublishedRender: PuckComponent<RowProps> = ({
  content: Content,
  gap,
  align,
  background,
  padding,
}) => (
    <section
      className={`cmsc:flex cmsc:flex-col cmsc:w-full cmsc-pb-gap cmsc-pb-padding ${responsiveRowAlignClass(align, 'stretch')}`}
      style={{
        background,
        ...buildResponsiveNumberVars('gap', gap, 24),
        ...buildResponsiveNumberVars('padding', padding, 0),
      }}
    >
      <Content minEmptyHeight={80} />
    </section>
  );

const rowConfig: ComponentConfig<{ props: RowProps }> = {
  label: 'Row',
  fields: {
    content: { type: 'slot' },
    gap: { type: 'number', label: 'Gap', min: 0, max: 96, step: 4, metadata: PB_RESPONSIVE_METADATA },
    align: {
      type: 'select',
      label: 'Align',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Stretch', value: 'stretch' },
        { label: 'Start', value: 'start' },
        { label: 'Center', value: 'center' },
        { label: 'End', value: 'end' },
      ],
    },
    background: { type: 'text', label: 'Background' },
    padding: { type: 'number', label: 'Padding', min: 0, max: 120, step: 4, metadata: PB_RESPONSIVE_METADATA },
  },
  defaultProps: {
    content: [],
    gap: 24,
    align: 'stretch',
    background: 'transparent',
    padding: 0,
  },
  render: (props) =>
    props.puck?.isEditing ? <RowEditingRender {...props} /> : <RowPublishedRender {...props} />,
};

export const Row = withHideOn(rowConfig);
