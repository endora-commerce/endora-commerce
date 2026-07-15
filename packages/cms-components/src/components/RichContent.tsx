'use client';

import { type ComponentConfig } from '@measured/puck';
import type { RichContentProps } from '../schema/component-types.js';
import { BOX_BORDER_FIELD, BOX_MARGIN_FIELD, BOX_PADDING_FIELD, DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';
import { RichContentEditorField } from './RichContentEditorField.js';
import { RichContentEditingPreviewRender, RichContentPublishedRender } from './RichContentPublished.js';
import { coerceRichContentProps, defaultRichContent, htmlFromTiptap } from './rich-content-shared.js';

export const RichContent: ComponentConfig<RichContentProps> = {
  label: 'Rich Content',
  fields: {
    content: {
      type: 'custom',
      label: 'Content',
      render: ({ value, onChange, readOnly }) => (
        <RichContentEditorField value={value ?? null} onChange={onChange} readOnly={readOnly} />
      ),
    },
    html: { type: 'textarea', label: 'HTML fallback' },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    content: defaultRichContent,
    html: '',
    ...DEFAULT_BOX_PROPS,
  },
  resolveData: async ({ props }, { changed }) => {
    const normalized = coerceRichContentProps(props);
    if (changed.content) {
      return {
        props: {
          ...normalized,
          html: htmlFromTiptap(normalized.content) || normalized.html,
        },
      };
    }
    return { props: normalized };
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <RichContentEditingPreviewRender {...props} />
    ) : (
      <RichContentPublishedRender {...props} />
    ),
};
