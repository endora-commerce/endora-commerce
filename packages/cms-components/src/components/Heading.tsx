import { type ComponentConfig } from '@measured/puck';
import type { CSSProperties } from 'react';
import type { HeadingProps } from '../schema/component-types.js';
import { baseFont } from './styles.js';

const sizeMap: Record<HeadingProps['level'], number> = {
  h1: 48,
  h2: 40,
  h3: 32,
  h4: 26,
  h5: 22,
  h6: 18,
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
    const style: CSSProperties = {
      ...baseFont,
      margin: 0,
      color: '#15202b',
      fontSize: sizeMap[level],
      lineHeight: 1.12,
      fontWeight: 700,
      textAlign: align,
    };

    return <Tag style={style}>{text}</Tag>;
  },
};
