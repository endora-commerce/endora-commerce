'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { PB_DATA_METADATA, withHideOn } from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { TestimonialProps } from '../schema/component-types.js';
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
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { resolveImageUrl } from '../utils/resolve-image-url.js';

function TestimonialBody({
  props,
  editing,
  tier,
}: {
  props: TestimonialProps;
  editing: boolean;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
}): React.ReactElement {
  const {
    quote,
    author = '',
    role = '',
    avatarSource = 'url',
    avatarUrl = '',
    avatarAssetId = '',
    background,
    cornerRadius,
    shadow,
    ...box
  } = props;
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const avatar = resolveImageUrl(
    {
      imageSource: avatarSource,
      ...(avatarUrl ? { src: avatarUrl } : {}),
      ...(avatarAssetId ? { assetId: avatarAssetId } : {}),
    },
    null,
    assets,
    mediaBaseUrl,
  );

  return (
    <BoxStyled
      {...box}
      {...(background !== undefined ? { background } : {})}
      {...(cornerRadius !== undefined ? { cornerRadius } : {})}
      {...(shadow !== undefined ? { shadow } : {})}
      {...(editing && tier ? { previewTier: tier } : {})}
      className="cmsc-pb-testimonial"
    >
      <blockquote className="cmsc-pb-testimonial__quote">{quote}</blockquote>
      <footer className="cmsc-pb-testimonial__footer">
        {avatar ? (
          <img
            src={avatar}
            alt={author ? `${author} avatar` : ''}
            className="cmsc-pb-testimonial__avatar"
          />
        ) : null}
        <div>
          {author ? <div className="cmsc-pb-testimonial__author">{author}</div> : null}
          {role ? <div className="cmsc-pb-testimonial__role">{role}</div> : null}
        </div>
      </footer>
    </BoxStyled>
  );
}

const TestimonialEditingRender: PuckComponent<TestimonialProps> = (props) => (
  <TestimonialBody props={props} editing tier={usePreviewBreakpointTier()} />
);

const TestimonialPublishedRender: PuckComponent<TestimonialProps> = (props) => (
  <TestimonialBody props={props} editing={false} tier={null} />
);

const TESTIMONIAL_FIELDS = {
  quote: { type: 'textarea' as const, label: 'Quote' },
  author: { type: 'text' as const, label: 'Author' },
  role: { type: 'text' as const, label: 'Role / company' },
  avatarSource: {
    type: 'select' as const,
    label: 'Avatar source',
    metadata: PB_DATA_METADATA,
    options: [
      { label: 'URL', value: 'url' },
      { label: 'Asset library', value: 'library' },
    ],
  },
  avatarUrl: { type: 'text' as const, label: 'Avatar URL', metadata: PB_DATA_METADATA },
  avatarAssetId: { type: 'text' as const, label: 'Avatar', metadata: PB_DATA_METADATA },
  background: BACKGROUND_FIELD,
  cornerRadius: CORNER_RADIUS_FIELD,
  shadow: SHADOW_FIELD,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const testimonialConfig: ComponentConfig<TestimonialProps> = {
  label: 'Testimonial',
  fields: TESTIMONIAL_FIELDS,
  defaultProps: {
    quote: '“This platform made our wholesale ordering dramatically simpler.”',
    author: 'Alex Kowalski',
    role: 'Procurement lead',
    avatarSource: 'url',
    avatarUrl: '',
    avatarAssetId: '',
    ...DEFAULT_BOX_PROPS,
    background: { kind: 'solid', color: '#f8fafc' },
    padding: { mode: 'uniform', value: 24 },
    cornerRadius: 'medium',
  },
  resolveFields: (data, { fields }) => {
    const source = data.props.avatarSource ?? 'url';
    const next = { ...fields };
    if (source === 'library') {
      delete next.avatarUrl;
    } else {
      delete next.avatarAssetId;
    }
    return next;
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <TestimonialEditingRender {...props} />
    ) : (
      <TestimonialPublishedRender {...props} />
    ),
};

export const Testimonial = withHideOn(testimonialConfig);
