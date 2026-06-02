import { type ComponentConfig } from '@measured/puck';
import type { ButtonProps, ButtonVariant } from '../schema/component-types.js';

// Verbatim colour reproduction of the former inline `variantStyles`, expressed as
// `cmsc:`-prefixed utility classes (feature 041).
const variantClass: Record<ButtonVariant, string> = {
  primary: 'cmsc:bg-[#1261a6] cmsc:border-[#1261a6] cmsc:text-white',
  secondary: 'cmsc:bg-white cmsc:border-[#1261a6] cmsc:text-[#1261a6]',
  ghost: 'cmsc:bg-transparent cmsc:border-transparent cmsc:text-[#1261a6]',
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
      className={`cmsc:font-sans cmsc:inline-flex cmsc:items-center cmsc:justify-center cmsc:min-h-[40px] cmsc:px-[18px] cmsc:border cmsc:border-solid cmsc:rounded-[8px] cmsc:text-[14px] cmsc:font-bold cmsc:leading-none cmsc:no-underline ${variantClass[variant]}`}
    >
      {label}
    </a>
  ),
};
