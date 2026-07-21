'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import type { CSSProperties } from 'react';
import {
  PB_RESPONSIVE_METADATA,
  buildResponsiveSpacingVars,
  createColorField,
  resolveResponsive,
  resolveResponsiveNumber,
  spacingStyleForTier,
  withHideOn,
  type SpacingValue,
  type ResponsiveProp,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { ButtonVariant, HeroProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BACKGROUND_FIELD,
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';
import { resolveButtonHref } from './button-link.js';

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'cmsc-pb-btn-primary',
  secondary: 'cmsc-pb-btn-secondary',
  ghost: 'cmsc-pb-btn-ghost',
};

function contentPaddingStyle(
  padding: SpacingValue | ResponsiveProp<SpacingValue> | undefined,
  tier: 'mobile' | 'tablet' | 'desktop' | null,
): CSSProperties {
  if (tier) return spacingStyleForTier(padding, tier, 'padding');
  return buildResponsiveSpacingVars('padding', padding);
}

function buttonColorStyle(props: {
  buttonBackgroundColor?: string | undefined;
  buttonTextColor?: string | undefined;
}): CSSProperties {
  const style: CSSProperties = {};
  if (props.buttonBackgroundColor && props.buttonBackgroundColor !== 'transparent') {
    style.backgroundColor = props.buttonBackgroundColor;
    style.borderColor = props.buttonBackgroundColor;
  }
  if (props.buttonTextColor && props.buttonTextColor !== 'transparent') {
    style.color = props.buttonTextColor;
  }
  return style;
}

function variantClasses(variant: HeroProps['buttonVariant']): string {
  const mobile = resolveResponsive(variant, 'mobile', 'primary');
  const tablet = resolveResponsive(variant, 'tablet', 'primary');
  const desktop = resolveResponsive(variant, 'desktop', 'primary');
  const classes = [variantStyles[mobile], 'cmsc-pb-btn-variant', 'cmsc-pb-hero__cta'];
  if (tablet !== mobile) classes.push(`cmsc-pb-btn-variant-md-${tablet}`);
  if (desktop !== tablet) classes.push(`cmsc-pb-btn-variant-lg-${desktop}`);
  return classes.join(' ');
}

const HERO_FIELDS = {
  heading: { type: 'text' as const, label: 'Heading' },
  subtitle: { type: 'textarea' as const, label: 'Subtitle' },
  buttonLabel: { type: 'text' as const, label: 'Button label' },
  buttonLinkType: {
    type: 'select' as const,
    label: 'Button link type',
    options: [
      { label: 'Static URL', value: 'url' },
      { label: 'Product', value: 'product' },
      { label: 'Category', value: 'category' },
      { label: 'CMS page', value: 'page' },
    ],
  },
  buttonLinkSlug: { type: 'text' as const, label: 'Button link target (slug)' },
  buttonHref: { type: 'text' as const, label: 'Button URL' },
  buttonTarget: {
    type: 'select' as const,
    label: 'Button target',
    options: [
      { label: 'Same tab', value: '_self' },
      { label: 'New tab', value: '_blank' },
    ],
  },
  buttonVariant: {
    type: 'select' as const,
    label: 'Button variant',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Primary', value: 'primary' },
      { label: 'Secondary', value: 'secondary' },
      { label: 'Ghost', value: 'ghost' },
    ],
  },
  buttonBackgroundColor: createColorField({ label: 'Button background' }),
  buttonTextColor: createColorField({ label: 'Button text color' }),
  background: BACKGROUND_FIELD,
  overlayOpacity: {
    type: 'number' as const,
    label: 'Overlay opacity (%)',
    min: 0,
    max: 90,
    step: 5,
  },
  textColor: createColorField({ label: 'Text color' }),
  contentAlign: {
    type: 'select' as const,
    label: 'Content align',
    options: [
      { label: 'Left', value: 'left' },
      { label: 'Center', value: 'center' },
      { label: 'Right', value: 'right' },
    ],
  },
  minHeightPx: {
    type: 'number' as const,
    label: 'Min height (px)',
    min: 160,
    max: 900,
    step: 8,
    metadata: PB_RESPONSIVE_METADATA,
  },
  cornerRadius: CORNER_RADIUS_FIELD,
  shadow: SHADOW_FIELD,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

function HeroBody({
  props,
  tier,
  editing,
}: {
  props: HeroProps;
  tier: 'mobile' | 'tablet' | 'desktop';
  editing: boolean;
}): React.ReactElement {
  const {
    heading,
    subtitle = '',
    buttonLabel = '',
    buttonHref = '',
    buttonLinkType = 'url',
    buttonLinkSlug = '',
    buttonTarget = '_self',
    buttonVariant = 'primary',
    buttonBackgroundColor,
    buttonTextColor,
    minHeightPx = 320,
    contentAlign = 'left',
    overlayOpacity = 40,
    textColor = '#ffffff',
    background,
    cornerRadius,
    shadow,
    padding,
    margin,
    border,
    ...rest
  } = props;
  const minHeight = resolveResponsiveNumber(minHeightPx, tier, 320);
  const overlayAlpha = Math.min(100, Math.max(0, overlayOpacity)) / 100;
  const resolvedHref = resolveButtonHref({
    linkType: buttonLinkType,
    linkSlug: buttonLinkSlug,
    href: buttonHref,
  });
  const resolvedVariant = resolveResponsive(buttonVariant, tier, 'primary');
  const colorStyle = buttonColorStyle({ buttonBackgroundColor, buttonTextColor });
  const hasCustomColors = Object.keys(colorStyle).length > 0;

  return (
    <BoxStyled
      {...rest}
      {...(margin !== undefined ? { margin } : {})}
      {...(border !== undefined ? { border } : {})}
      {...(background !== undefined ? { background } : {})}
      {...(cornerRadius !== undefined ? { cornerRadius } : {})}
      {...(shadow !== undefined ? { shadow } : {})}
      {...(editing ? { previewTier: tier } : {})}
      className="cmsc-pb-hero"
      style={
        {
          minHeight: `${minHeight}px`,
          color: textColor,
          ['--cmsc-hero-overlay' as string]: String(overlayAlpha),
        } as CSSProperties
      }
    >
      {/* Frame fills the background area (no padding). Overlay covers 100%. */}
      <div className="cmsc-pb-hero__frame">
        <div className="cmsc-pb-hero__overlay" aria-hidden />
        <div
          className={`cmsc-pb-hero__content${editing ? '' : ' cmsc-pb-padding'}`}
          style={{
            textAlign: contentAlign,
            ...contentPaddingStyle(padding, editing ? tier : null),
          }}
        >
          <h2 className="cmsc-pb-hero__heading">{heading}</h2>
          {subtitle ? <p className="cmsc-pb-hero__subtitle">{subtitle}</p> : null}
          {buttonLabel ? (
            <a
              className={
                hasCustomColors
                  ? 'cmsc-pb-hero__cta cmsc:inline-flex cmsc:items-center cmsc:justify-center cmsc:min-h-[40px] cmsc:px-[18px] cmsc:border cmsc:border-solid cmsc:rounded-[8px] cmsc:text-[14px] cmsc:font-bold cmsc:leading-none cmsc:no-underline'
                  : editing
                    ? `${variantStyles[resolvedVariant]} cmsc-pb-btn-variant cmsc-pb-hero__cta cmsc:inline-flex cmsc:items-center cmsc:justify-center cmsc:min-h-[40px] cmsc:px-[18px] cmsc:border cmsc:border-solid cmsc:rounded-[8px] cmsc:text-[14px] cmsc:font-bold cmsc:leading-none cmsc:no-underline`
                    : `${variantClasses(buttonVariant)} cmsc:inline-flex cmsc:items-center cmsc:justify-center cmsc:min-h-[40px] cmsc:px-[18px] cmsc:border cmsc:border-solid cmsc:rounded-[8px] cmsc:text-[14px] cmsc:font-bold cmsc:leading-none cmsc:no-underline`
              }
              href={resolvedHref || '#'}
              target={buttonTarget}
              rel={buttonTarget === '_blank' ? 'noreferrer' : undefined}
              style={colorStyle}
            >
              {buttonLabel}
            </a>
          ) : null}
        </div>
      </div>
    </BoxStyled>
  );
}

const HeroEditingRender: PuckComponent<HeroProps> = (props) => (
  <HeroBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const HeroPublishedRender: PuckComponent<HeroProps> = (props) => (
  <HeroBody props={props} tier={useViewportBreakpointTier()} editing={false} />
);

const heroConfig: ComponentConfig<HeroProps> = {
  label: 'Hero / CTA banner',
  fields: HERO_FIELDS,
  defaultProps: {
    heading: 'Grow your B2B sales',
    subtitle: 'Publish landing pages with catalog, content, and CTAs in one place.',
    buttonLabel: 'Get started',
    buttonLinkType: 'url',
    buttonLinkSlug: '',
    buttonHref: '/',
    buttonTarget: '_self',
    buttonVariant: 'primary',
    minHeightPx: 360,
    contentAlign: 'left',
    overlayOpacity: 45,
    textColor: '#ffffff',
    ...DEFAULT_BOX_PROPS,
    background: {
      kind: 'gradient',
      gradientFrom: '#0f766e',
      gradientTo: '#134e4a',
      gradientAngle: 135,
    },
    padding: { mode: 'uniform', value: 48 },
  },
  resolveFields: (data) => {
    const linkType = data.props.buttonLinkType ?? 'url';
    if (linkType === 'url') {
      const { buttonLinkSlug: _removed, ...rest } = HERO_FIELDS;
      return rest as typeof HERO_FIELDS;
    }
    const { buttonHref: _removed, ...rest } = HERO_FIELDS;
    return rest as typeof HERO_FIELDS;
  },
  resolveData: async ({ props }) => {
    const linkType = props.buttonLinkType ?? 'url';
    const href = resolveButtonHref({
      linkType,
      linkSlug: props.buttonLinkSlug,
      href: props.buttonHref,
    });
    if (linkType !== 'url' && href !== props.buttonHref) {
      return { props: { ...props, buttonHref: href } };
    }
    return { props };
  },
  render: (props) =>
    props.puck?.isEditing ? <HeroEditingRender {...props} /> : <HeroPublishedRender {...props} />,
};

export const Hero = withHideOn(heroConfig);
