import { type ComponentConfig } from '@measured/puck';
import type { InsertTemplateProps } from '../schema/component-types.js';
import { emptyEmbed } from './styles.js';
import { useCmsRenderEmbeds } from './render-context.js';

export const InsertTemplate: ComponentConfig<InsertTemplateProps> = {
  label: 'Insert Template',
  fields: {
    code: { type: 'text', label: 'Template code' },
  },
  defaultProps: {
    code: '',
  },
  render: ({ code }) => {
    const { templates } = useCmsRenderEmbeds();
    const rendered = code ? templates[code] : null;

    if (rendered) return <>{rendered}</>;

    return <div style={emptyEmbed}>{code ? `Template "${code}"` : 'Choose a template code'}</div>;
  },
};
