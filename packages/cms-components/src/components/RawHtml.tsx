'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { withHideOn } from '@b2b/page-builder-core';
import type { RawHtmlProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { sanitizeHtml } from '../utils/sanitize-html.js';

const RawHtmlRender: PuckComponent<RawHtmlProps> = (props) => {
  const { html, sanitize = true, puck, ...box } = props;
  const editing = puck?.isEditing === true;
  const safe = sanitizeHtml(html ?? '', sanitize);

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})} className="cmsc-pb-raw-html">
      {editing && !html ? (
        <p className="cmsc:text-sm cmsc:text-[#64748b] cmsc:italic">Raw HTML — trusted admin content</p>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: safe }} />
      )}
    </BoxStyled>
  );
};

const rawHtmlConfig: ComponentConfig<RawHtmlProps> = {
  label: 'Raw HTML',
  fields: {
    html: { type: 'textarea', label: 'HTML' },
    sanitize: {
      type: 'radio',
      label: 'Sanitize',
      options: [
        { label: 'On (recommended)', value: true },
        { label: 'Off (trusted)', value: false },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    html: '<p>Custom HTML</p>',
    sanitize: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: RawHtmlRender,
};

export const RawHtml = withHideOn(rawHtmlConfig);
