import { type ComponentConfig } from '@measured/puck';
import type { CSSProperties } from 'react';
import type { ButtonProps, ButtonVariant } from '../schema/component-types.js';
import { baseFont } from './styles.js';

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: '#1261a6',
    borderColor: '#1261a6',
    color: '#ffffff',
  },
  secondary: {
    background: '#ffffff',
    borderColor: '#1261a6',
    color: '#1261a6',
  },
  ghost: {
    background: 'transparent',
    borderColor: 'transparent',
    color: '#1261a6',
  },
};

export const Button: ComponentConfig<ButtonProps> = {
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
  render: ({ label, href, target, variant }) => (
    <a
      href={href || '#'}
      target={target}
      rel={target === '_blank' ? 'noreferrer' : undefined}
      style={{
        ...baseFont,
        ...variantStyles[variant],
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 40,
        padding: '0 18px',
        border: '1px solid',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 700,
        lineHeight: 1,
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  ),
};
