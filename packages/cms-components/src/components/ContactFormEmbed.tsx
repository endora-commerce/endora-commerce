'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { withHideOn } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { ContactFormEmbedProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';

function ContactFormBody({
  props,
  editing,
  tier,
}: {
  props: ContactFormEmbedProps;
  editing: boolean;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
}): React.ReactElement {
  const {
    heading = '',
    description = '',
    embedUrl = '',
    mailto = '',
    heightPx = 480,
    ...box
  } = props;

  return (
    <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})} className="cmsc-pb-contact">
      {heading ? <h3 className="cmsc-pb-contact__heading">{heading}</h3> : null}
      {description ? <p className="cmsc-pb-contact__desc">{description}</p> : null}
      {embedUrl ? (
        <iframe
          title={heading || 'Contact form'}
          src={embedUrl}
          className="cmsc-pb-contact__iframe"
          style={{ height: `${heightPx}px` }}
          loading="lazy"
        />
      ) : mailto ? (
        <a className="cmsc-pb-contact__mailto" href={`mailto:${mailto}`}>
          Email {mailto}
        </a>
      ) : editing ? (
        <p className="cmsc:text-sm cmsc:text-[#64748b]">
          Set an embed URL or mailto address for this contact block.
        </p>
      ) : null}
    </BoxStyled>
  );
}

const ContactEditingRender: PuckComponent<ContactFormEmbedProps> = (props) => (
  <ContactFormBody props={props} editing tier={usePreviewBreakpointTier()} />
);

const ContactPublishedRender: PuckComponent<ContactFormEmbedProps> = (props) => (
  <ContactFormBody props={props} editing={false} tier={null} />
);

const contactConfig: ComponentConfig<ContactFormEmbedProps> = {
  label: 'Contact / form embed',
  fields: {
    heading: { type: 'text', label: 'Heading' },
    description: { type: 'textarea', label: 'Description' },
    embedUrl: { type: 'text', label: 'Form embed URL (iframe)' },
    mailto: { type: 'text', label: 'Mailto fallback' },
    heightPx: { type: 'number', label: 'Embed height (px)', min: 200, max: 1200 },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    heading: 'Contact us',
    description: 'Send a message to our sales team.',
    embedUrl: '',
    mailto: 'sales@example.com',
    heightPx: 480,
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <ContactEditingRender {...props} /> : <ContactPublishedRender {...props} />,
};

export const ContactFormEmbed = withHideOn(contactConfig);
