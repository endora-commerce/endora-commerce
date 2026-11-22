'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  contentDefaultFor,
  createAspectRatioField,
  createColorField,
  PAGE_BUILDER_CONTENT_DEFAULTS,
  isAspectToken,
  normalizeResponsive,
  PB_DATA_METADATA,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  withHideOn,
  type BreakpointTier,
  type ContentDefaultPropsMap,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';
import { useEditorCarouselPage } from '@endora-commerce/page-builder-core/editor/carousel-preview';
import type { CmsBlogPostCard } from '../schema/blog-types.js';
import type { HeaderButtonPlacement, LatestPostsProps, SectionGap } from '../schema/component-types.js';
import { gapField, gapPxField, hoverZoomField, sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';
import { CORNER_RADIUS_FIELD } from '../fields/shared-fields.js';
import { sanitizeRatio, ratioToCss } from '../utils/aspect-ratio.js';
import { colorValueToCss } from '../utils/color-value.js';
import { mediaRadiusPx } from '../utils/media-radius.js';
import { buttonWidthClasses, buttonWidthField } from './button-full-width.js';
import { ItemText } from './item-text.js';
import { textWeightCss, textWeightField } from './typography.js';
import { singleWeight } from './text-style.js';
import { useBlockData } from '../hooks/use-block-data.js';
import { blogPostsDataRequest, LATEST_POSTS_DEFAULT_LIMIT, LATEST_POSTS_MAX_LIMIT } from '../utils/block-data.js';
import { CarouselShell } from './carousel/CarouselShell.js';
import {
  CAROUSEL_HEADER_FIELDS,
  CAROUSEL_TRACK_FIELDS,
  CarouselHeaderBlock,
  carouselHeaderNode,
  carouselShellOptions,
  carouselPlacementMoved,
  withoutUnusedCarouselFields,
} from './carousel/carousel-parts.js';
import { gapCss, gapVars, isUnusedHeadingMaxWidthPx, responsiveVars, usesCustom, type TextSize } from './section-parts.js';
import { ButtonView } from './ButtonView.js';
import { specAtTier } from './Button.js';

/**
 * `blog.LatestPosts` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US6, FR-026, research R-15. Declared by the `blog`
 * module's manifest; rendered here, as the catalogue blocks are.
 *
 * The newest `limit` published posts of the page's channel, optionally of one
 * category, as cards — an image in a 2:1 frame, the primary category as a
 * chip, the title and a read-more link — in a carousel (the Carousel's
 * options) or a grid. An optional header carries a heading, a lead and a
 * button (for example to the blog index).
 *
 * The posts are resolved by the page's server render (`utils/block-data.ts`)
 * and read here synchronously, so they are in the HTML. With none, customers
 * see nothing and the preview says "No posts". While `blog` is off the block
 * is filtered from the render and its read is skipped (Principle XVII).
 *
 * T189 (R15) adds the card's look — background, corners, padding around the
 * card and beside its text, the image ratio per breakpoint, zoom on hover,
 * the chip's style, the title's size and weight per breakpoint, and the
 * read-more link's icon, alignment and weight — and the header's lead size
 * and colour and its button's placement (below the lead, at the header's end
 * or after the posts) and width per breakpoint. The block writes them as
 * classes and custom properties on its root (`latestPostsLook`); every one
 * unset renders today's card byte for byte, and the stylesheet's fallbacks
 * are today's literals.
 */

const DEFAULT_COLUMNS = { base: 1, tablet: 2, desktop: 3 };

function postHref(post: CmsBlogPostCard): string {
  return post.url && post.url.startsWith('/') ? post.url : `/blog/${encodeURIComponent(post.slug)}`;
}

/** T189: what a card renders beyond today's: the chip, the title's text, the read-more icon and weight. */
interface PostCardLook {
  chip: boolean;
  title: (name: string) => ReactNode;
  moreIcon: 'arrow' | 'plus' | null;
  moreWeight: number | undefined;
}

const MORE_ICON_PATHS: Record<'arrow' | 'plus', string> = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  plus: 'M12 5v14m-7-7h14',
};

function PostCard({ post, readMoreLabel, look }: { post: CmsBlogPostCard; readMoreLabel: string; look: PostCardLook }): ReactNode {
  const href = postHref(post);
  const chip = look.chip ? post.primaryCategoryName?.trim() || '' : '';
  return (
    <article className="cmsc-pb-post-card">
      <a href={href} className="cmsc-pb-post-card__media" tabIndex={-1} aria-hidden="true">
        {post.mainImageUrl ? <img src={post.mainImageUrl} alt="" loading="lazy" decoding="async" /> : null}
      </a>
      <div className="cmsc-pb-post-card__body">
        {chip ? <span className="cmsc-pb-post-card__chip">{chip}</span> : null}
        <h3 className="cmsc-pb-post-card__title">
          <a href={href}>{look.title(post.name)}</a>
        </h3>
        {readMoreLabel ? (
          <a
            href={href}
            className={`cmsc-pb-post-card__more${look.moreIcon ? ' cmsc-pb-post-card__more--icon' : ''}`}
            aria-label={`${readMoreLabel}: ${post.name}`}
            {...(look.moreWeight !== undefined ? { style: { fontWeight: look.moreWeight } } : {})}
          >
            {readMoreLabel}
            {look.moreIcon ? (
              <svg
                className="cmsc-pb-post-card__more-icon"
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={MORE_ICON_PATHS[look.moreIcon]} />
              </svg>
            ) : null}
          </a>
        ) : null}
      </div>
    </article>
  );
}

// ── T189: the card's look and the header button's placement ──────────

const TIERS: readonly BreakpointTier[] = ['mobile', 'tablet', 'desktop'];
const TIER_SUFFIX: Record<BreakpointTier, string> = { mobile: '', tablet: '-md', desktop: '-lg' };
const PLACEMENTS: readonly HeaderButtonPlacement[] = ['below', 'end', 'after'];
/** Today's text padding: 16 px above, none beside. */
const TODAY_TEXT_PADDING = { top: '16px', side: '0px' } as const;
const DEFAULT_RATIO = '2:1';

type Spacing = SectionGap | ResponsiveProp<SectionGap> | undefined;

const isSet = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/** Whether a tier holds a value of its own or inherits one from below (a value without `base` leaves the tiers below it unset). */
function tierSet(value: unknown, tier: BreakpointTier): boolean {
  return isSet(resolveResponsive<unknown>(value, tier, undefined));
}

/** A spacing option's CSS at a tier, or `null` where the tier is unset. */
function spacingAt(value: Spacing, px: number | ResponsiveProp<number> | undefined, tier: BreakpointTier): string | null {
  return tierSet(value, tier) ? gapCss(value, px, 0, tier) : null;
}

/** The header button's placement at a tier; anything unknown is today's. */
function placementAt(value: LatestPostsProps['headerButtonPlacement'], tier: BreakpointTier): HeaderButtonPlacement {
  const at = resolveResponsive<unknown>(value, tier, 'below');
  return PLACEMENTS.includes(at as HeaderButtonPlacement) ? (at as HeaderButtonPlacement) : 'below';
}

/** The image ratio, kept only where it is an aspect token (not `auto`), or `undefined`. */
function imageRatioOf(value: unknown): string | ResponsiveProp<string> | undefined {
  if (typeof value === 'string') return isAspectToken(value) && value !== 'auto' ? value : undefined;
  if (value !== null && typeof value === 'object') return sanitizeRatio(value as ResponsiveProp<string>, DEFAULT_RATIO, false);
  return undefined;
}

export interface LatestPostsLook {
  classes: string[];
  vars: Record<string, string>;
  /** The header button's placements: in the header (below the lead or at its end) and after the posts. */
  buttonInHeader: boolean;
  buttonAfter: boolean;
}

/**
 * T189: the block root's classes and custom properties for the card's look and
 * the header button's placement. Published (`tier` `null`), a value per
 * breakpoint is written per tier; in the editor, the previewed tier's only.
 */
export function latestPostsLook(props: LatestPostsProps, tier: BreakpointTier | null): LatestPostsLook {
  const classes: string[] = [];
  const vars: Record<string, string> = {};
  const tiers = tier === null ? TIERS : [tier];
  const suffix = (t: BreakpointTier): string => (tier === null ? TIER_SUFFIX[t] : '');

  const background = colorValueToCss(props.cardBackground);
  if (background) vars['--cmsc-post-card-bg'] = background;
  const radius = mediaRadiusPx(props.cardRadius);
  if (radius !== null) vars['--cmsc-post-card-radius'] = radius;
  if (props.hoverZoom === true) classes.push('cmsc-pb-latest-posts--zoom');

  if (TIERS.some((t) => tierSet(props.cardPadding, t))) {
    classes.push('cmsc-pb-latest-posts--card-pad');
    Object.assign(vars, gapVars('cmsc-post-card-pad', props.cardPadding, props.cardPaddingPx, 0, tier));
  }
  if (TIERS.some((t) => tierSet(props.cardTextPadding, t))) {
    classes.push('cmsc-pb-latest-posts--text-pad');
    for (const t of tiers) {
      const css = spacingAt(props.cardTextPadding, props.cardTextPaddingPx, t);
      vars[`--cmsc-post-text-top${suffix(t)}`] = css ?? TODAY_TEXT_PADDING.top;
      vars[`--cmsc-post-text-side${suffix(t)}`] = css ?? TODAY_TEXT_PADDING.side;
    }
  }

  const ratio = imageRatioOf(props.imageRatio);
  if (ratio !== undefined) {
    if (tier !== null) {
      vars['--cmsc-post-ratio'] = ratioToCss(resolveResponsive<string>(ratio, tier, DEFAULT_RATIO));
    } else {
      const responsive = normalizeResponsive<string>(ratio, DEFAULT_RATIO);
      const tablet = responsive.tablet ?? responsive.base;
      const desktop = responsive.desktop ?? tablet;
      vars['--cmsc-post-ratio'] = ratioToCss(responsive.base);
      vars['--cmsc-post-ratio-md'] = ratioToCss(tablet);
      vars['--cmsc-post-ratio-lg'] = ratioToCss(desktop);
    }
  }

  if (props.chipStyle === 'outline') classes.push('cmsc-pb-latest-posts--chip-outline');
  if (props.readMoreAlign === 'end') classes.push('cmsc-pb-latest-posts--more-end');
  const leadColor = colorValueToCss(props.leadColor);
  if (leadColor) {
    classes.push('cmsc-pb-latest-posts--lead-color');
    vars['--cmsc-lp-lead-color'] = leadColor;
  }

  const placements = tiers.map((t) => placementAt(props.headerButtonPlacement, t));
  if (placements.some((p) => p !== 'below')) {
    if (tier !== null) {
      classes.push(`cmsc-pb-latest-posts--action-${placements[0]!}`);
    } else {
      const [mobile, tablet, desktop] = placements as [HeaderButtonPlacement, HeaderButtonPlacement, HeaderButtonPlacement];
      classes.push(`cmsc-pb-latest-posts--action-${mobile}`);
      if (tablet !== mobile) classes.push(`cmsc-pb-latest-posts--md-action-${tablet}`);
      if (desktop !== tablet) classes.push(`cmsc-pb-latest-posts--lg-action-${desktop}`);
    }
  }
  return {
    classes,
    vars,
    buttonInHeader: placements.some((p) => p !== 'after'),
    buttonAfter: placements.includes('after'),
  };
}

function LatestPostsBody({
  props,
  tier,
  preview,
  previewPage = 0,
  carouselId,
}: {
  props: LatestPostsProps;
  tier: BreakpointTier | null;
  preview: boolean;
  previewPage?: number;
  carouselId?: string;
}): ReactNode {
  const { loading, data } = useBlockData<CmsBlogPostCard[]>(
    blogPostsDataRequest({ limit: props.limit, categorySlug: props.categorySlug }),
  );
  const posts = data ?? [];
  // #1684 — a stored block with no label gets the content default of the page's language.
  const { language } = useBlockRenderEnvironment();
  const readMoreLabel = props.readMoreLabel ?? contentDefaultFor(language, 'latestPosts.readMoreLabel');

  if (loading || posts.length === 0) {
    // Customers never see a placeholder: the storefront resolved the posts on the server.
    if (!preview) return null;
    return (
      <p className="cmsc-pb-latest-posts__empty" role="note">
        {loading ? 'Loading posts…' : 'No posts'}
      </p>
    );
  }

  const look = latestPostsLook(props, tier);
  const moreWeight = textWeightCss(props.readMoreWeight);
  const cardLook: PostCardLook = {
    chip: props.chipStyle !== 'none',
    title: (name) => (
      <ItemText
        className="cmsc-pb-post-card__title-text"
        size={props.cardTitleSize as TextSize | ResponsiveProp<TextSize> | undefined}
        sizePx={props.cardTitleSizePx}
        font={undefined}
        weight={props.cardTitleWeight}
        fallback="h6"
        tier={tier}
      >
        {name}
      </ItemText>
    ),
    moreIcon: props.readMoreIcon === 'arrow' || props.readMoreIcon === 'plus' ? props.readMoreIcon : null,
    moreWeight,
  };
  const cards = posts.map((post) => <PostCard key={post.id} post={post} readMoreLabel={readMoreLabel} look={cardLook} />);

  // T189: the lead's size, the header button's place and width.
  const actionClassNames = buttonWidthClasses(props.headerButtonFullWidth, tier, 'cmsc-btn-list');
  const headerOptions = {
    lead: (text: string) => (
      <ItemText
        className="cmsc-pb-carousel__lead-text"
        size={props.leadSize as TextSize | ResponsiveProp<TextSize> | undefined}
        sizePx={props.leadSizePx}
        font={undefined}
        /* R22I (T379): the lead's weight — R23 (T435): one value for every breakpoint. */
        weight={singleWeight(props.leadWeight)}
        fallback="body"
        tier={tier}
      >
        {text}
      </ItemText>
    ),
    button: look.buttonInHeader,
    actionClassNames,
  };
  const button = props.header?.button && props.header.button.label?.trim() ? props.header.button : null;
  const afterAction =
    look.buttonAfter && button ? (
      <div className={['cmsc-pb-actions', 'cmsc-pb-latest-posts__action', ...actionClassNames].join(' ')}>
        <ButtonView button={tier !== null ? specAtTier(button, tier) : button} />
      </div>
    ) : null;
  const rootClass = (layout: 'grid' | 'carousel'): string =>
    ['cmsc-pb-latest-posts', `cmsc-pb-latest-posts--${layout}`, ...look.classes].join(' ');
  const rootStyle = Object.keys(look.vars).length > 0 ? { style: look.vars as CSSProperties } : {};

  if (props.layout === 'grid') {
    const style = {
      ...responsiveVars<number>('cmsc-lp-cols', props.columns, DEFAULT_COLUMNS.base, (n) => String(Math.min(4, Math.max(1, Math.round(n)))), tier),
      ...gapVars('cmsc-lp-gap', props.gap, props.gapPx, 16, tier),
    } as CSSProperties;
    return (
      <div className={rootClass('grid')} {...rootStyle}>
        <CarouselHeaderBlock props={props} tier={tier} options={headerOptions} />
        <div className="cmsc-pb-latest-posts__grid" style={style}>
          {cards}
        </div>
        {afterAction}
      </div>
    );
  }

  const label = typeof props.header?.heading === 'string' ? props.header.heading : undefined;
  return (
    <div className={rootClass('carousel')} {...rootStyle}>
      <CarouselShell
        {...carouselShellOptions(props, { slidesPerView: { base: 1.15, tablet: 2, desktop: 3 } })}
        header={carouselHeaderNode(props, tier, headerOptions)}
        {...(label ? { label } : {})}
        {...(tier !== null
          ? {
              editorPreview: true,
              previewTier: tier,
              previewPage,
              ...(carouselId !== undefined ? { editorCarouselId: carouselId } : {}),
            }
          : {})}
        {...(carouselId ? { instanceId: carouselId } : {})}
      >
        {cards}
      </CarouselShell>
      {afterAction}
    </div>
  );
}

const LatestPostsEditingRender: PuckComponent<LatestPostsProps> = (props) => {
  const id = (props as { id?: string }).id;
  const previewPage = useEditorCarouselPage(id);
  return (
    <LatestPostsBody
      props={props as unknown as LatestPostsProps}
      tier={usePreviewBreakpointTier()}
      preview
      previewPage={previewPage}
      {...(id !== undefined ? { carouselId: id } : {})}
    />
  );
};

const LatestPostsPublishedRender: PuckComponent<LatestPostsProps> = (props) => {
  const environment = useBlockRenderEnvironment();
  const id = (props as { id?: string }).id;
  return (
    <LatestPostsBody
      props={props as unknown as LatestPostsProps}
      tier={null}
      preview={environment.preview === true}
      {...(id !== undefined ? { carouselId: id } : {})}
    />
  );
};

const LATEST_POSTS_FIELDS = {
  ...CAROUSEL_HEADER_FIELDS,
  // R17 (T219): what is listed, on the Data tab (the admin picks the category from the blog's).
  limit: { type: 'number' as const, label: 'Number of posts', min: 1, max: LATEST_POSTS_MAX_LIMIT, metadata: PB_DATA_METADATA },
  categorySlug: { type: 'text' as const, label: 'Category (optional)', metadata: PB_DATA_METADATA },
  layout: {
    type: 'radio' as const,
    label: 'Layout',
    options: [
      { label: 'Carousel', value: 'carousel' },
      { label: 'Grid', value: 'grid' },
    ],
  },
  columns: { type: 'number' as const, label: 'Columns', min: 1, max: 4, metadata: PB_RESPONSIVE_METADATA },
  readMoreLabel: { type: 'text' as const, label: 'Read-more label' },
  // T189: the header's lead and button.
  leadSize: sizeFieldWithDefault('Lead size'),
  leadSizePx: sizePxField('Custom lead size (px)', 10, 80),
  // R22I (T379): the lead's weight; Default keeps today's. R23 (T435): one value.
  leadWeight: textWeightField('Lead weight'),
  leadColor: createColorField({ label: 'Lead color' }),
  headerButtonPlacement: {
    type: 'select' as const,
    label: 'Header button placement',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Below the lead', value: 'below' },
      { label: 'At the end of the header', value: 'end' },
      { label: 'After the posts', value: 'after' },
    ],
  },
  headerButtonFullWidth: buttonWidthField('Header button width'),
  // T189: the post card's look; each first option (or unset) is today's.
  cardBackground: createColorField({ label: 'Card background' }),
  // R17 (T210): the block's one corner setting reads "Rounded corners".
  cardRadius: CORNER_RADIUS_FIELD,
  cardPadding: gapField('Card padding'),
  cardPaddingPx: { ...gapPxField('Custom card padding (px)'), max: 80 },
  cardTextPadding: gapField('Text padding'),
  cardTextPaddingPx: { ...gapPxField('Custom text padding (px)'), max: 80 },
  imageRatio: createAspectRatioField({ label: 'Image ratio', defaultRatio: DEFAULT_RATIO, allowAuto: false }),
  hoverZoom: hoverZoomField(),
  chipStyle: {
    type: 'select' as const,
    label: 'Category chip',
    options: [
      { label: 'Filled', value: 'filled' },
      { label: 'Outline', value: 'outline' },
      { label: 'Hidden', value: 'none' },
    ],
  },
  cardTitleSize: sizeFieldWithDefault('Card title size'),
  cardTitleSizePx: sizePxField('Custom card title size (px)', 10, 80),
  cardTitleWeight: { ...textWeightField('Card title weight'), metadata: PB_RESPONSIVE_METADATA },
  readMoreIcon: {
    type: 'select' as const,
    label: 'Read-more icon',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Arrow', value: 'arrow' },
      { label: 'Plus', value: 'plus' },
    ],
  },
  readMoreAlign: {
    type: 'radio' as const,
    label: 'Read-more alignment',
    options: [
      { label: 'Left', value: 'start' },
      { label: 'Right', value: 'end' },
    ],
  },
  readMoreWeight: textWeightField('Read-more weight'),
  ...CAROUSEL_TRACK_FIELDS,
};

/** The carousel-only options, hidden for the grid. */
const CAROUSEL_ONLY = new Set(['slidesPerView', 'effect', 'controls', 'controlsPlacement', 'controlsAlign', 'controlsAlignTo', 'loop', 'bleed', 'autoplay', 'intervalMs', 'equalHeight']);

const latestPostsConfig: ComponentConfig<{ props: LatestPostsProps }> = {
  label: 'Latest posts',
  fields: LATEST_POSTS_FIELDS as unknown as Fields<LatestPostsProps>,
  defaultProps: {
    headingLevel: 'h2',
    headingSize: 'h3',
    limit: LATEST_POSTS_DEFAULT_LIMIT,
    categorySlug: '',
    layout: 'carousel',
    columns: DEFAULT_COLUMNS,
    // #1684 — the English; an editor seeds it in the edited content language (`LATEST_POSTS_CONTENT_DEFAULT_PROPS`).
    readMoreLabel: PAGE_BUILDER_CONTENT_DEFAULTS.en['latestPosts.readMoreLabel'],
    slidesPerView: { base: 1.15, tablet: 2, desktop: 3 },
    gap: 's',
    effect: 'slide',
    controls: { arrows: true, dots: false },
    controlsPlacement: 'below',
    bleed: 'none',
    autoplay: false,
    intervalMs: 6000,
    equalHeight: true,
  } as LatestPostsProps,
  // T129: a placement stored inside `controls` moves to `controlsPlacement` once opened.
  resolveData: ({ props }) => ({ props: carouselPlacementMoved(props as LatestPostsProps) }),
  // Filters the host's field set, so the admin's pickers survive.
  resolveFields: (data, params) => {
    const props = data.props as LatestPostsProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? LATEST_POSTS_FIELDS)) {
      if (key === 'gapPx' && !usesCustom(props.gap)) continue;
      if (key === 'headingSizePx' && !usesCustom(props.headingSize)) continue;
      if (key === 'headingLineHeight' && !usesCustom(props.headingSize)) continue;
      if (key === 'leadSizePx' && !usesCustom(props.leadSize)) continue;
      if (key === 'cardTitleSizePx' && !usesCustom(props.cardTitleSize)) continue;
      if (key === 'cardPaddingPx' && !usesCustom(props.cardPadding)) continue;
      if (key === 'cardTextPaddingPx' && !usesCustom(props.cardTextPadding)) continue;
      if (isUnusedHeadingMaxWidthPx(key, props)) continue;
      if (props.layout === 'grid' && CAROUSEL_ONLY.has(key)) continue;
      if (props.layout !== 'grid' && key === 'columns') continue;
      if (key === 'slidesPerView' && props.effect === 'fade') continue;
      fields[key] = field;
    }
    // R17 (T213): the interval, the arrows' look and the controls' placement only where they apply.
    if (props.layout !== 'grid') withoutUnusedCarouselFields(props, fields);
    return fields as unknown as Fields<LatestPostsProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <LatestPostsEditingRender {...props} /> : <LatestPostsPublishedRender {...props} />,
};

export const LatestPosts = withHideOn(latestPostsConfig);

/**
 * The latest posts' default props that are content (#1684): a host building
 * an editor config seeds them in the edited content language with
 * `withContentDefaultProps`.
 */
export const LATEST_POSTS_CONTENT_DEFAULT_PROPS = {
  'blog.LatestPosts': { readMoreLabel: 'latestPosts.readMoreLabel' },
} as const satisfies ContentDefaultPropsMap;
