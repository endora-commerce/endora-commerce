'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { withHideOn } from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { NewsletterSignupProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BACKGROUND_FIELD,
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';

function NewsletterBody({
  props,
  editing,
  tier,
}: {
  props: NewsletterSignupProps;
  editing: boolean;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
}): React.ReactElement {
  const {
    heading = '',
    description = '',
    placeholder = 'you@company.com',
    buttonLabel = 'Subscribe',
    actionUrl = '',
    background,
    cornerRadius,
    shadow,
    ...box
  } = props;

  return (
    <BoxStyled
      {...box}
      {...(background !== undefined ? { background } : {})}
      {...(cornerRadius !== undefined ? { cornerRadius } : {})}
      {...(shadow !== undefined ? { shadow } : {})}
      {...(editing && tier ? { previewTier: tier } : {})}
      className="cmsc-pb-newsletter"
    >
      {heading ? <h3 className="cmsc-pb-newsletter__heading">{heading}</h3> : null}
      {description ? <p className="cmsc-pb-newsletter__desc">{description}</p> : null}
      <form
        className="cmsc-pb-newsletter__form"
        action={actionUrl || undefined}
        method={actionUrl ? 'post' : undefined}
        onSubmit={actionUrl ? undefined : (e): void => e.preventDefault()}
      >
        <input
          type="email"
          name="email"
          required
          placeholder={placeholder}
          className="cmsc-pb-newsletter__input"
          aria-label="Email"
        />
        <button type="submit" className="cmsc-pb-newsletter__button">
          {buttonLabel}
        </button>
      </form>
      {editing && !actionUrl ? (
        <p className="cmsc:text-xs cmsc:text-[#94a3b8] cmsc:mt-2">
          Set Action URL to wire this form to your newsletter endpoint.
        </p>
      ) : null}
    </BoxStyled>
  );
}

const NewsletterEditingRender: PuckComponent<NewsletterSignupProps> = (props) => (
  <NewsletterBody props={props} editing tier={usePreviewBreakpointTier()} />
);

const NewsletterPublishedRender: PuckComponent<NewsletterSignupProps> = (props) => (
  <NewsletterBody props={props} editing={false} tier={null} />
);

const newsletterConfig: ComponentConfig<NewsletterSignupProps> = {
  label: 'Newsletter signup',
  fields: {
    heading: { type: 'text', label: 'Heading' },
    description: { type: 'textarea', label: 'Description' },
    placeholder: { type: 'text', label: 'Email placeholder' },
    buttonLabel: { type: 'text', label: 'Button label' },
    actionUrl: { type: 'text', label: 'Form action URL' },
    background: BACKGROUND_FIELD,
    cornerRadius: CORNER_RADIUS_FIELD,
    shadow: SHADOW_FIELD,
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    heading: 'Stay in the loop',
    description: 'Product updates and wholesale offers — no spam.',
    placeholder: 'you@company.com',
    buttonLabel: 'Subscribe',
    actionUrl: '',
    ...DEFAULT_BOX_PROPS,
    background: { kind: 'solid', color: '#f0fdfa' },
    padding: { mode: 'uniform', value: 24 },
    cornerRadius: 'medium',
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <NewsletterEditingRender {...props} />
    ) : (
      <NewsletterPublishedRender {...props} />
    ),
};

export const NewsletterSignup = withHideOn(newsletterConfig);
