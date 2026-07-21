'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  createColorField,
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { SocialNetwork, SocialProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import {
  SOCIAL_BRAND_COLORS,
  SOCIAL_NETWORK_ICONS,
  SOCIAL_NETWORK_LABELS,
  socialItemSummary,
} from './social-networks.js';

function SocialBody({
  props,
  tier,
  editing,
}: {
  props: SocialProps;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
  editing: boolean;
}): React.ReactElement {
  const {
    items = [],
    layout = 'icons-with-labels',
    size = 22,
    gap = 12,
    color = '#15202b',
    useBrandColors = false,
    align,
    ...box
  } = props;
  const alignAttrs = textAlignDataAttrs(align, 'left');

  if (items.length === 0) {
    return (
      <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
        <p className="cmsc:text-sm cmsc:text-[#64748b]">
          {editing ? 'Add social links in the Items tab.' : null}
        </p>
      </BoxStyled>
    );
  }

  const listClass = ['cmsc-pb-social', `cmsc-pb-social--${layout}`].join(' ');

  return (
    <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
      <div
        className={tier ? 'cmsc-pb-text-align' : responsiveTextAlignClass(align, 'left')}
        style={tier ? { textAlign: resolveTextAlignForTier(align, tier, 'left') } : undefined}
        {...alignAttrs}
      >
        <ul className={listClass} style={{ gap: `${gap}px` }}>
          {items.map((item, index) => {
            const network = (item.network in SOCIAL_NETWORK_ICONS
              ? item.network
              : 'website') as SocialNetwork;
            const Icon = SOCIAL_NETWORK_ICONS[network];
            const label = item.label?.trim() || SOCIAL_NETWORK_LABELS[network];
            const iconColor = useBrandColors ? SOCIAL_BRAND_COLORS[network] : color;
            const showLabel = layout !== 'icons-only';
            return (
              <li key={`${network}-${index}`}>
                <a
                  href={item.url || '#'}
                  className="cmsc-pb-social__link"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                >
                  <Icon size={size} color={iconColor} aria-hidden />
                  {showLabel ? <span className="cmsc-pb-social__label">{label}</span> : null}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </BoxStyled>
  );
}

const SocialEditingRender: PuckComponent<SocialProps> = (props) => (
  <SocialBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const SocialPublishedRender: PuckComponent<SocialProps> = (props) => (
  <SocialBody props={props} tier={null} editing={false} />
);

const socialConfig: ComponentConfig<SocialProps> = {
  label: 'Social',
  fields: {
    items: {
      type: 'array',
      label: 'Links',
      getItemSummary: (item, index) => socialItemSummary(item, index),
      arrayFields: {
        network: {
          type: 'select',
          label: 'Network',
          options: [
            { label: 'Facebook', value: 'facebook' },
            { label: 'X', value: 'x' },
            { label: 'Instagram', value: 'instagram' },
            { label: 'LinkedIn', value: 'linkedin' },
            { label: 'YouTube', value: 'youtube' },
            { label: 'TikTok', value: 'tiktok' },
            { label: 'Website', value: 'website' },
            { label: 'Email', value: 'email' },
          ],
        },
        label: { type: 'text', label: 'Label (optional)' },
        url: { type: 'text', label: 'URL' },
      },
      defaultItemProps: {
        network: 'linkedin',
        label: '',
        url: '',
      },
    },
    layout: {
      type: 'select',
      label: 'Layout',
      options: [
        { label: 'Icons only', value: 'icons-only' },
        { label: 'Icons with labels', value: 'icons-with-labels' },
        { label: 'Vertical list', value: 'vertical-list' },
        { label: 'Pills', value: 'pills' },
      ],
    },
    size: { type: 'number', label: 'Icon size (px)', min: 14, max: 48 },
    gap: { type: 'number', label: 'Gap (px)', min: 0, max: 48 },
    color: createColorField({ label: 'Icon color' }),
    useBrandColors: {
      type: 'radio',
      label: 'Use brand colors',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
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
      { network: 'linkedin', label: '', url: 'https://www.linkedin.com/' },
      { network: 'facebook', label: '', url: 'https://www.facebook.com/' },
    ],
    layout: 'icons-with-labels',
    size: 22,
    gap: 12,
    color: '#15202b',
    useBrandColors: true,
    align: 'left',
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <SocialEditingRender {...props} /> : <SocialPublishedRender {...props} />,
};

export const Social = withHideOn(socialConfig);
