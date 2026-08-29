'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  createColorField,
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { IconsProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { createIconPickerField } from './IconPickerField.js';
import { resolveCmsIcon } from './icon-catalog.js';

function IconsBody({
  props,
  tier,
  editing,
}: {
  props: IconsProps;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
  editing: boolean;
}): React.ReactElement {
  const { name, size = 32, color = '#15202b', strokeWidth = 2, align, href, linkTarget, ...box } =
    props;
  const Icon = resolveCmsIcon(name);
  const alignAttrs = textAlignDataAttrs(align, 'left');

  const iconNode = Icon ? (
    <Icon size={size} color={color} strokeWidth={strokeWidth} aria-hidden={!href} />
  ) : editing ? (
    <span className="cmsc:text-sm cmsc:text-[#64748b]">Select an icon</span>
  ) : null;

  const content =
    href && Icon ? (
      <a
        href={href}
        target={linkTarget ?? '_self'}
        rel={linkTarget === '_blank' ? 'noreferrer' : undefined}
        className="cmsc:inline-flex"
        aria-label={name}
      >
        {iconNode}
      </a>
    ) : (
      <span className="cmsc:inline-flex">{iconNode}</span>
    );

  return (
    <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
      <div
        className={tier ? 'cmsc-pb-text-align' : responsiveTextAlignClass(align, 'left')}
        style={tier ? { textAlign: resolveTextAlignForTier(align, tier, 'left') } : undefined}
        {...alignAttrs}
      >
        {content}
      </div>
    </BoxStyled>
  );
}

const IconsEditingRender: PuckComponent<IconsProps> = (props) => (
  <IconsBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const IconsPublishedRender: PuckComponent<IconsProps> = (props) => (
  <IconsBody props={props} tier={null} editing={false} />
);

const iconsConfig: ComponentConfig<IconsProps> = {
  label: 'Icons',
  fields: {
    name: createIconPickerField('Icon'),
    size: { type: 'number', label: 'Size (px)', min: 12, max: 128, step: 2 },
    color: createColorField({ label: 'Color' }),
    strokeWidth: { type: 'number', label: 'Stroke width', min: 1, max: 3, step: 0.25 },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    href: { type: 'text', label: 'Link URL (optional)' },
    linkTarget: {
      type: 'select',
      label: 'Link target',
      options: [
        { label: 'Same tab', value: '_self' },
        { label: 'New tab', value: '_blank' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    name: 'star',
    size: 32,
    color: '#15202b',
    strokeWidth: 2,
    align: 'left',
    href: '',
    linkTarget: '_self',
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <IconsEditingRender {...props} /> : <IconsPublishedRender {...props} />,
};

export const Icons = withHideOn(iconsConfig);
