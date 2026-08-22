'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  resolveResponsiveNumber,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { BreakpointTier } from '@endora-commerce/page-builder-core';
import type { VideoProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { aspectPadding, buildVideoEmbedUrl } from '../utils/video-embed.js';

function alignClass(align: VideoProps['align'], tier: BreakpointTier): string {
  const value = resolveResponsive(align, tier, 'center');
  if (value === 'left') return 'cmsc:mr-auto';
  if (value === 'right') return 'cmsc:ml-auto';
  return 'cmsc:mx-auto';
}

function VideoBody({
  props,
  tier,
  editing,
}: {
  props: VideoProps;
  tier: BreakpointTier;
  editing: boolean;
}): React.ReactElement {
  const {
    url,
    provider = 'auto',
    aspectRatio = '16:9',
    autoplay = false,
    muted = false,
    loop = false,
    controls = true,
    title = 'Video',
    align,
    maxWidth,
    puck: _puck,
    ...box
  } = props as VideoProps & { puck?: unknown };
  const embedUrl = buildVideoEmbedUrl(url, provider, { autoplay, muted, loop, controls });
  const maxW = resolveResponsiveNumber(maxWidth, tier, 100);
  const padding = aspectPadding(aspectRatio);

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <div
        className={`cmsc-pb-video cmsc:w-full ${alignClass(align, tier)}`}
        style={{ maxWidth: maxW === 100 ? undefined : `${maxW}%` }}
      >
        {embedUrl ? (
          <div className="cmsc:relative cmsc:w-full cmsc:overflow-hidden cmsc:rounded-lg" style={{ paddingTop: padding }}>
            <iframe
              src={embedUrl}
              title={title}
              className="cmsc:absolute cmsc:inset-0 cmsc:h-full cmsc:w-full cmsc:border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="cmsc:text-sm cmsc:text-[#64748b]">
            {editing ? 'Enter a valid YouTube, Vimeo, or HTTPS video URL' : null}
          </p>
        )}
      </div>
    </BoxStyled>
  );
}

const VideoEditingRender: PuckComponent<VideoProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  return <VideoBody props={props} tier={tier} editing />;
};

const VideoPublishedRender: PuckComponent<VideoProps> = (props) => {
  const tier = useViewportBreakpointTier();
  return <VideoBody props={props} tier={tier} editing={false} />;
};

const videoConfig: ComponentConfig<VideoProps> = {
  label: 'Video',
  fields: {
    url: { type: 'text', label: 'Video URL' },
    provider: {
      type: 'select',
      label: 'Provider',
      options: [
        { label: 'Auto-detect', value: 'auto' },
        { label: 'YouTube', value: 'youtube' },
        { label: 'Vimeo', value: 'vimeo' },
        { label: 'Generic (HTTPS iframe)', value: 'generic' },
      ],
    },
    aspectRatio: {
      type: 'select',
      label: 'Aspect ratio',
      options: [
        { label: '16:9', value: '16:9' },
        { label: '4:3', value: '4:3' },
        { label: '1:1', value: '1:1' },
      ],
    },
    title: { type: 'text', label: 'Title (accessibility)' },
    autoplay: { type: 'radio', label: 'Autoplay', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    muted: { type: 'radio', label: 'Muted', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    loop: { type: 'radio', label: 'Loop', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    controls: { type: 'radio', label: 'Controls', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    maxWidth: {
      type: 'number',
      label: 'Max width (%)',
      min: 25,
      max: 100,
      metadata: PB_RESPONSIVE_METADATA,
    },
    align: {
      type: 'select',
      label: 'Align',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    url: '',
    provider: 'auto',
    aspectRatio: '16:9',
    title: 'Video',
    autoplay: false,
    muted: false,
    loop: false,
    controls: true,
    maxWidth: 100,
    align: 'center',
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <VideoEditingRender {...props} /> : <VideoPublishedRender {...props} />,
};

export const Video = withHideOn(videoConfig);
