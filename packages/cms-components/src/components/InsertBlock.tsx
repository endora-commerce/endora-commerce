import { type ComponentConfig } from '@measured/puck';
import type { InsertBlockProps } from '../schema/component-types.js';
import { emptyEmbed } from './styles.js';
import { useCmsRenderEmbeds } from './render-context.js';

export const InsertBlock: ComponentConfig<InsertBlockProps> = {
  label: 'Insert Block',
  fields: {
    code: { type: 'text', label: 'Block code' },
  },
  defaultProps: {
    code: '',
  },
  render: ({ code }) => {
    const { blocks } = useCmsRenderEmbeds();
    const rendered = code ? blocks[code] : null;

    if (rendered) return <>{rendered}</>;

    return <div style={emptyEmbed}>{code ? `Block "${code}"` : 'Choose a block code'}</div>;
  },
};
