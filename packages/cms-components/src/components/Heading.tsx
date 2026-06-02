import { type ComponentConfig } from '@measured/puck';
import type { HeadingProps } from '../schema/component-types.js';

// Per-level font sizes + alignment, expressed as `cmsc:`-prefixed utilities
// (verbatim from the former `sizeMap` px values). Feature 041.
const sizeClass: Record<HeadingProps['level'], string> = {
  h1: 'cmsc:text-[48px]',
  h2: 'cmsc:text-[40px]',
  h3: 'cmsc:text-[32px]',
  h4: 'cmsc:text-[26px]',
  h5: 'cmsc:text-[22px]',
  h6: 'cmsc:text-[18px]',
};

const alignClass: Record<HeadingProps['align'], string> = {
  left: 'cmsc:text-left',
  center: 'cmsc:text-center',
  right: 'cmsc:text-right',
};

export const Heading: ComponentConfig<HeadingProps> = {
  label: 'Heading',
  fields: {
    level: {
      type: 'select',
      label: 'Level',
      options: [
        { label: 'H1', value: 'h1' },
        { label: 'H2', value: 'h2' },
        { label: 'H3', value: 'h3' },
        { label: 'H4', value: 'h4' },
        { label: 'H5', value: 'h5' },
        { label: 'H6', value: 'h6' },
      ],
    },
    text: { type: 'textarea', label: 'Text', contentEditable: true },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
  },
  defaultProps: {
    level: 'h2',
    text: 'Section heading',
    align: 'left',
  },
  render: ({ level, text, align }) => {
    const Tag = level;
    const className = `cmsc:font-sans cmsc:m-0 cmsc:text-[#15202b] cmsc:leading-[1.12] cmsc:font-bold ${sizeClass[level]} ${alignClass[align]}`;

    return <Tag className={className}>{text}</Tag>;
  },
};
