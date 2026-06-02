import { type ComponentConfig } from '@measured/puck';
import type { InsertTemplateProps } from '../schema/component-types.js';
import { useCmsRenderEmbeds } from './render-context.js';

// Former `emptyEmbed` CSSProperties as `cmsc:`-prefixed utilities (verbatim:
// 1px dashed #9aa7b4, radius 8, padding 16, #5f6b7a on #f8fafc, 14px, Inter). Feature 041.
const EMPTY_EMBED =
  'cmsc:font-sans cmsc:border cmsc:border-dashed cmsc:border-[#9aa7b4] cmsc:rounded-[8px] cmsc:p-[16px] cmsc:text-[#5f6b7a] cmsc:bg-[#f8fafc] cmsc:text-[14px]';

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

    return (
      <div className={EMPTY_EMBED}>{code ? `Template "${code}"` : 'Choose a template code'}</div>
    );
  },
};
