'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import type { CSSProperties } from 'react';
import {
  createColorField,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { ButtonProps, ButtonVariant } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
  TEXT_COLOR_FIELD,
} from '../fields/shared-fields.js';
import { resolveButtonHref } from './button-link.js';

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'cmsc-pb-btn-primary',
  secondary: 'cmsc-pb-btn-secondary',
  ghost: 'cmsc-pb-btn-ghost',
};

const BUTTON_FIELDS = {
  label: { type: 'text' as const, label: 'Label' },
  linkType: {
    type: 'select' as const,
    label: 'Link type',
    options: [
      { label: 'Static URL', value: 'url' },
      { label: 'Product', value: 'product' },
      { label: 'Category', value: 'category' },
      { label: 'CMS page', value: 'page' },
    ],
  },
  linkSlug: { type: 'text' as const, label: 'Link target (slug)' },
  href: { type: 'text' as const, label: 'URL' },
  target: {
    type: 'select' as const,
    label: 'Target',
    options: [
      { label: 'Same tab', value: '_self' },
      { label: 'New tab', value: '_blank' },
    ],
  },
  variant: {
    type: 'select' as const,
    label: 'Variant',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Primary', value: 'primary' },
      { label: 'Secondary', value: 'secondary' },
      { label: 'Ghost', value: 'ghost' },
    ],
  },
  backgroundColor: createColorField({ label: 'Background color' }),
  textColor: TEXT_COLOR_FIELD,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

function variantClasses(variant: ButtonProps['variant']): string {
  const mobile = resolveResponsive(variant, 'mobile', 'primary');
  const tablet = resolveResponsive(variant, 'tablet', 'primary');
  const desktop = resolveResponsive(variant, 'desktop', 'primary');
  const classes = [variantStyles[mobile], 'cmsc-pb-btn-variant'];
  if (tablet !== mobile) classes.push(`cmsc-pb-btn-variant-md-${tablet}`);
  if (desktop !== tablet) classes.push(`cmsc-pb-btn-variant-lg-${desktop}`);
  return classes.join(' ');
}

function buttonColorStyle(props: {
  backgroundColor?: string | undefined;
  textColor?: string | undefined;
}): CSSProperties {
  const style: CSSProperties = {};
  if (props.backgroundColor && props.backgroundColor !== 'transparent') {
    style.backgroundColor = props.backgroundColor;
    style.borderColor = props.backgroundColor;
  }
  if (props.textColor && props.textColor !== 'transparent') {
    style.color = props.textColor;
  }
  return style;
}

function ButtonAnchor({
  label,
  href,
  target,
  variantClass,
  colorStyle,
}: {
  label: string;
  href: string;
  target: ButtonProps['target'];
  variantClass: string;
  colorStyle: CSSProperties;
}): React.ReactElement {
  const hasCustomColors = Object.keys(colorStyle).length > 0;
  return (
    <a
      href={href}
      target={target}
      rel={target === '_blank' ? 'noreferrer' : undefined}
      className={`cmsc:font-sans cmsc:inline-flex cmsc:items-center cmsc:justify-center cmsc:min-h-[40px] cmsc:px-[18px] cmsc:border cmsc:border-solid cmsc:rounded-[8px] cmsc:text-[14px] cmsc:font-bold cmsc:leading-none cmsc:no-underline ${hasCustomColors ? '' : variantClass}`}
      style={colorStyle}
    >
      {label}
    </a>
  );
}

const ButtonEditingRender: PuckComponent<ButtonProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const { label, target, variant, linkType, linkSlug, href, backgroundColor, textColor, ...box } = props;
  const resolvedVariant = resolveResponsive(variant, tier, 'primary');
  const resolvedHref = resolveButtonHref({ linkType, linkSlug, href });

  return (
    <BoxStyled previewTier={tier} {...box}>
      <ButtonAnchor
        label={label}
        href={resolvedHref}
        target={target}
        variantClass={variantStyles[resolvedVariant]}
        colorStyle={buttonColorStyle({ backgroundColor, textColor })}
      />
    </BoxStyled>
  );
};

const ButtonPublishedRender: PuckComponent<ButtonProps> = (props) => {
  const { label, target, variant, linkType, linkSlug, href, backgroundColor, textColor, ...box } = props;
  const resolvedHref = resolveButtonHref({ linkType, linkSlug, href });

  return (
    <BoxStyled {...box}>
      <ButtonAnchor
        label={label}
        href={resolvedHref}
        target={target}
        variantClass={variantClasses(variant)}
        colorStyle={buttonColorStyle({ backgroundColor, textColor })}
      />
    </BoxStyled>
  );
};

const buttonConfig: ComponentConfig<{ props: ButtonProps }> = {
  label: 'Button',
  fields: BUTTON_FIELDS,
  defaultProps: {
    label: 'Call to action',
    linkType: 'url',
    linkSlug: '',
    href: '/',
    target: '_self',
    variant: 'primary',
    ...DEFAULT_BOX_PROPS,
  },
  resolveFields: (data) => {
    const linkType = data.props.linkType ?? 'url';
    if (linkType === 'url') {
      const { linkSlug: _removed, ...rest } = BUTTON_FIELDS;
      return rest as typeof BUTTON_FIELDS;
    }
    const { href: _removed, ...rest } = BUTTON_FIELDS;
    return rest as typeof BUTTON_FIELDS;
  },
  resolveData: async ({ props }) => {
    const linkType = props.linkType ?? 'url';
    const href = resolveButtonHref(props);
    if (linkType !== 'url' && href !== props.href) {
      return { props: { ...props, href } };
    }
    return { props };
  },
  render: (props) =>
    props.puck?.isEditing ? <ButtonEditingRender {...props} /> : <ButtonPublishedRender {...props} />,
};

export const Button = withHideOn(buttonConfig);
