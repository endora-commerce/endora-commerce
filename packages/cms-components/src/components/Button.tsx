'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { ButtonProps, ButtonVariant } from '../schema/component-types.js';

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'cmsc-pb-btn-primary',
  secondary: 'cmsc-pb-btn-secondary',
  ghost: 'cmsc-pb-btn-ghost',
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

const ButtonEditingRender: PuckComponent<ButtonProps> = ({ label, href, target, variant }) => {
  const tier = usePreviewBreakpointTier();
  const resolvedVariant = resolveResponsive(variant, tier, 'primary');

  return (
    <a
      href={href || '#'}
      target={target}
      rel={target === '_blank' ? 'noreferrer' : undefined}
      className={`cmsc:font-sans cmsc:inline-flex cmsc:items-center cmsc:justify-center cmsc:min-h-[40px] cmsc:px-[18px] cmsc:border cmsc:border-solid cmsc:rounded-[8px] cmsc:text-[14px] cmsc:font-bold cmsc:leading-none cmsc:no-underline ${variantStyles[resolvedVariant]}`}
    >
      {label}
    </a>
  );
};

const ButtonPublishedRender: PuckComponent<ButtonProps> = ({ label, href, target, variant }) => (
    <a
      href={href || '#'}
      target={target}
      rel={target === '_blank' ? 'noreferrer' : undefined}
      className={`cmsc:font-sans cmsc:inline-flex cmsc:items-center cmsc:justify-center cmsc:min-h-[40px] cmsc:px-[18px] cmsc:border cmsc:border-solid cmsc:rounded-[8px] cmsc:text-[14px] cmsc:font-bold cmsc:leading-none cmsc:no-underline ${variantClasses(variant)}`}
    >
      {label}
    </a>
);

const buttonConfig: ComponentConfig<{ props: ButtonProps }> = {
  label: 'Button',
  fields: {
    label: { type: 'text', label: 'Label' },
    href: { type: 'text', label: 'Link' },
    target: {
      type: 'select',
      label: 'Target',
      options: [
        { label: 'Same tab', value: '_self' },
        { label: 'New tab', value: '_blank' },
      ],
    },
    variant: {
      type: 'select',
      label: 'Variant',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Primary', value: 'primary' },
        { label: 'Secondary', value: 'secondary' },
        { label: 'Ghost', value: 'ghost' },
      ],
    },
  },
  defaultProps: {
    label: 'Call to action',
    href: '/',
    target: '_self',
    variant: 'primary',
  },
  render: (props) =>
    props.puck?.isEditing ? <ButtonEditingRender {...props} /> : <ButtonPublishedRender {...props} />,
};

export const Button = withHideOn(buttonConfig);
