'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  createColorField,
  resolveResponsiveNumber,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { SpacerProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';

function SpacerBody({
  props,
  tier,
}: {
  props: SpacerProps;
  tier: 'mobile' | 'tablet' | 'desktop';
}): React.ReactElement {
  const height = resolveResponsiveNumber(props.heightPx, tier, 48);
  return (
    <div
      className="cmsc-pb-spacer"
      style={{ height: `${Math.max(0, height)}px` }}
      aria-hidden
    >
      {props.showDivider ? (
        <hr
          className="cmsc-pb-spacer__divider"
          style={props.dividerColor ? { borderColor: props.dividerColor } : undefined}
        />
      ) : null}
    </div>
  );
}

const SpacerEditingRender: PuckComponent<SpacerProps> = (props) => (
  <SpacerBody props={props} tier={usePreviewBreakpointTier()} />
);

const SpacerPublishedRender: PuckComponent<SpacerProps> = (props) => (
  <SpacerBody props={props} tier={useViewportBreakpointTier()} />
);

const spacerConfig: ComponentConfig<SpacerProps> = {
  label: 'Spacer / Divider',
  fields: {
    heightPx: {
      type: 'number',
      label: 'Height (px)',
      min: 0,
      max: 400,
      step: 4,
      metadata: PB_RESPONSIVE_METADATA,
    },
    showDivider: {
      type: 'radio',
      label: 'Show divider line',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    dividerColor: createColorField({ label: 'Divider color' }),
  },
  defaultProps: {
    heightPx: 48,
    showDivider: false,
    dividerColor: '#e2e8f0',
  },
  resolveFields: (data, { fields }) => {
    if (data.props.showDivider) return fields;
    const { dividerColor: _c, ...rest } = fields;
    return rest;
  },
  render: (props) =>
    props.puck?.isEditing ? <SpacerEditingRender {...props} /> : <SpacerPublishedRender {...props} />,
};

export const Spacer = withHideOn(spacerConfig);
