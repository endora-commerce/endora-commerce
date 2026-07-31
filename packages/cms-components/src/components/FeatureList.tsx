'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  createColorField,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { FeatureListProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { createIconPickerField } from './IconPickerField.js';
import { resolveCmsIcon } from './icon-catalog.js';

function FeatureListBody({
  props,
  tier,
  editing,
}: {
  props: FeatureListProps;
  tier: 'mobile' | 'tablet' | 'desktop';
  editing: boolean;
}): React.ReactElement {
  const {
    items = [],
    columns = 3,
    gap = 24,
    iconColor = '#0f766e',
    iconSize = 28,
    align = 'left',
    ...box
  } = props;
  const cols = Math.max(1, Math.min(4, Math.round(resolveResponsiveNumber(columns, tier, 3))));
  const gapPx = resolveResponsiveNumber(gap, tier, 24);

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <ul
        className="cmsc-pb-feature-list"
        style={{
          gap: `${gapPx}px`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          textAlign: align,
        }}
      >
        {items.map((item, index) => {
          const Icon = resolveCmsIcon(item.icon);
          return (
            <li key={`${item.title}-${index}`} className="cmsc-pb-feature-list__item">
              {Icon ? (
                <span className="cmsc-pb-feature-list__icon">
                  <Icon size={iconSize} color={iconColor} aria-hidden />
                </span>
              ) : null}
              <h3 className="cmsc-pb-feature-list__title">{item.title}</h3>
              {item.description ? (
                <p className="cmsc-pb-feature-list__desc">{item.description}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editing && items.length === 0 ? (
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Add features in the Items tab.</p>
      ) : null}
    </BoxStyled>
  );
}

const FeatureListEditingRender: PuckComponent<FeatureListProps> = (props) => (
  <FeatureListBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const FeatureListPublishedRender: PuckComponent<FeatureListProps> = (props) => (
  <FeatureListBody props={props} tier={useViewportBreakpointTier()} editing={false} />
);

const featureListConfig: ComponentConfig<FeatureListProps> = {
  label: 'Feature list',
  fields: {
    items: {
      type: 'array',
      label: 'Features',
      getItemSummary: (item) => item.title || 'Feature',
      arrayFields: {
        icon: createIconPickerField('Icon') as never,
        title: { type: 'text', label: 'Title' },
        description: { type: 'textarea', label: 'Description' },
      },
      defaultItemProps: {
        icon: 'checkCircle2',
        title: 'Feature',
        description: 'Short supporting copy.',
      },
    },
    columns: {
      type: 'number',
      label: 'Columns',
      min: 1,
      max: 4,
      metadata: PB_RESPONSIVE_METADATA,
    },
    gap: {
      type: 'number',
      label: 'Gap (px)',
      min: 0,
      max: 64,
      metadata: PB_RESPONSIVE_METADATA,
    },
    iconColor: createColorField({ label: 'Icon color' }),
    iconSize: { type: 'number', label: 'Icon size (px)', min: 16, max: 64 },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    items: [
      { icon: 'truck', title: 'Fast delivery', description: 'Reliable logistics for B2B orders.' },
      { icon: 'shieldCheck', title: 'Secure', description: 'Enterprise-grade account security.' },
      { icon: 'lifeBuoy', title: 'Support', description: 'Dedicated sales and support team.' },
    ],
    columns: 3,
    gap: 24,
    iconColor: '#0f766e',
    iconSize: 28,
    align: 'left',
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <FeatureListEditingRender {...props} />
    ) : (
      <FeatureListPublishedRender {...props} />
    ),
};

export const FeatureList = withHideOn(featureListConfig);
