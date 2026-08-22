'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  createColorField,
  resolveResponsiveNumber,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { StatsProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';

function StatsBody({
  props,
  tier,
  editing,
}: {
  props: StatsProps;
  tier: 'mobile' | 'tablet' | 'desktop';
  editing: boolean;
}): React.ReactElement {
  const {
    items = [],
    columns = 4,
    gap = 24,
    align = 'center',
    valueColor = '#0f766e',
    ...box
  } = props;
  const cols = Math.max(1, Math.min(6, Math.round(resolveResponsiveNumber(columns, tier, 4))));

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <ul
        className="cmsc-pb-stats"
        style={{
          gap: `${gap}px`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          textAlign: align,
        }}
      >
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="cmsc-pb-stats__item">
            <div className="cmsc-pb-stats__value" style={{ color: valueColor }}>
              {item.value}
            </div>
            <div className="cmsc-pb-stats__label">{item.label}</div>
          </li>
        ))}
      </ul>
    </BoxStyled>
  );
}

const StatsEditingRender: PuckComponent<StatsProps> = (props) => (
  <StatsBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const StatsPublishedRender: PuckComponent<StatsProps> = (props) => (
  <StatsBody props={props} tier={useViewportBreakpointTier()} editing={false} />
);

const statsConfig: ComponentConfig<StatsProps> = {
  label: 'Stats',
  fields: {
    items: {
      type: 'array',
      label: 'Metrics',
      getItemSummary: (item) => `${item.value || '—'} · ${item.label || 'Metric'}`,
      arrayFields: {
        value: { type: 'text', label: 'Value' },
        label: { type: 'text', label: 'Label' },
      },
      defaultItemProps: { value: '100+', label: 'Customers' },
    },
    columns: {
      type: 'number',
      label: 'Columns',
      min: 1,
      max: 6,
      metadata: PB_RESPONSIVE_METADATA,
    },
    gap: { type: 'number', label: 'Gap (px)', min: 0, max: 64 },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    valueColor: createColorField({ label: 'Value color' }),
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    items: [
      { value: '2.5k+', label: 'SKU online' },
      { value: '98%', label: 'On-time delivery' },
      { value: '40+', label: 'Markets' },
      { value: '24/7', label: 'Support' },
    ],
    columns: 4,
    gap: 24,
    align: 'center',
    valueColor: '#0f766e',
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <StatsEditingRender {...props} /> : <StatsPublishedRender {...props} />,
};

export const Stats = withHideOn(statsConfig);
