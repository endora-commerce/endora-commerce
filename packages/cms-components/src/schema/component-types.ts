import type { Slot } from '@measured/puck';
import type {
  BorderValue,
  BackgroundProp,
  CornerRadius,
  HideOn,
  ResponsiveProp,
  Shadow,
  SpacingValue,
} from '@endora-commerce/page-builder-core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonTarget = '_self' | '_blank';
export type ButtonLinkType = 'url' | 'product' | 'category' | 'page';
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface HideOnProps {
  editorName?: string;
  hideOn?: HideOn;
}

export interface BoxStyleProps {
  margin?: SpacingValue | ResponsiveProp<SpacingValue>;
  padding?: SpacingValue | ResponsiveProp<SpacingValue>;
  border?: BorderValue | ResponsiveProp<BorderValue>;
}

export interface AppearanceProps {
  background?: BackgroundProp;
  cornerRadius?: CornerRadius;
  shadow?: Shadow;
}

export interface ColumnProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  span: number | ResponsiveProp<number>;
  content: Slot;
}

export interface RowColumnItem {
  span: number | ResponsiveProp<number>;
  content: Slot;
}

export interface RowProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  content: Slot;
  /** @deprecated migrated to Column components in content slot */
  columnItems?: RowColumnItem[];
  sectionLayout: RowSectionLayout | ResponsiveProp<RowSectionLayout>;
  contentMaxWidth: RowContentMaxWidth | ResponsiveProp<RowContentMaxWidth>;
  customMaxWidthPx?: number | ResponsiveProp<number>;
  /** @deprecated use sectionLayout */
  fullBleed?: boolean;
  /** @deprecated use contentMaxWidth */
  contentWidth?: 'full' | 'narrow' | 'wide' | ResponsiveProp<'full' | 'narrow' | 'wide'>;
  contentPosition: 'top' | 'middle' | 'bottom' | ResponsiveProp<'top' | 'middle' | 'bottom'>;
  minHeight: number | ResponsiveProp<number>;
  gap: number | ResponsiveProp<number>;
  rowGap?: number | ResponsiveProp<number>;
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'stretch' | ResponsiveProp<'top' | 'middle' | 'bottom' | 'stretch'>;
  columnDivider?: boolean;
  reverseOnMobile?: boolean;
  overflow: boolean;
}

export type RowSectionLayout = 'in_flow' | 'full_width' | 'full_viewport' | 'full_bleed';
export type RowContentMaxWidth = 'none' | 'narrow' | 'wide' | 'custom';

export type TextFontFamily = 'sans' | 'serif' | 'mono';
export type TextFontStyle = 'normal' | 'italic';

export interface TypographyProps {
  fontFamily?: TextFontFamily;
  fontStyle?: TextFontStyle;
  color?: string;
  fontSize?: number | ResponsiveProp<number>;
  fontWeight?: number | ResponsiveProp<number>;
  textAlign?: 'left' | 'center' | 'right' | ResponsiveProp<'left' | 'center' | 'right'>;
  lineHeight?: number | ResponsiveProp<number>;
}

export interface HeadingProps extends HideOnProps, BoxStyleProps, TypographyProps {
  level: HeadingLevel;
  text: string;
  /** @deprecated use textAlign */
  align?: 'left' | 'center' | 'right' | ResponsiveProp<'left' | 'center' | 'right'>;
}

export interface TextProps extends HideOnProps, BoxStyleProps, TypographyProps {
  text?: string;
  /** Legacy rows saved before Simple Text — read-only fallback at render time. */
  tiptapContent?: { type?: string; content?: unknown[] } | null;
  /** Legacy rows saved before Simple Text — read-only fallback at render time. */
  html?: string;
}

export type ImageAlign = 'left' | 'center' | 'right';

export interface IconsProps extends HideOnProps, BoxStyleProps {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  align?: ImageAlign | ResponsiveProp<ImageAlign>;
  href?: string;
  linkTarget?: '_self' | '_blank';
}

export type SocialNetwork =
  | 'facebook'
  | 'x'
  | 'instagram'
  | 'linkedin'
  | 'youtube'
  | 'tiktok'
  | 'website'
  | 'email';

export type SocialLayout = 'icons-only' | 'icons-with-labels' | 'vertical-list' | 'pills';

export interface SocialItem {
  network: SocialNetwork;
  label?: string;
  url: string;
}

export interface SocialProps extends HideOnProps, BoxStyleProps {
  items: SocialItem[];
  layout?: SocialLayout;
  size?: number;
  gap?: number;
  color?: string;
  useBrandColors?: boolean;
  align?: ImageAlign | ResponsiveProp<ImageAlign>;
}

export type ImageObjectFit = 'cover' | 'contain' | 'fill' | 'none';
export type ImageWidthMode = 'auto' | 'full' | 'custom';
export type ImageSourceKind = 'url' | 'library';

export interface ImageProps extends HideOnProps, BoxStyleProps {
  imageSource?: ImageSourceKind;
  src: string;
  assetId?: string;
  alt: string;
  href: string;
  linkTarget: '_self' | '_blank';
  objectFit: ImageObjectFit;
  opacity: number;
  cornerRadius?: CornerRadius;
  widthMode: ImageWidthMode | ResponsiveProp<ImageWidthMode>;
  widthPx: number | ResponsiveProp<number>;
  align: ImageAlign | ResponsiveProp<ImageAlign>;
}

export interface RichContentProps extends HideOnProps, BoxStyleProps {
  content: import('@tiptap/core').JSONContent | null;
  /** Synced from TipTap in resolveData — not shown as an author-facing field. */
  html: string;
}

export interface ButtonProps extends HideOnProps, BoxStyleProps {
  label: string;
  linkType: ButtonLinkType;
  linkSlug?: string;
  href: string;
  target: ButtonTarget;
  variant: ButtonVariant | ResponsiveProp<ButtonVariant>;
  backgroundColor?: string;
  textColor?: string;
}

export interface InsertBlockProps extends HideOnProps {
  code: string;
}

export interface InsertTemplateProps extends HideOnProps {
  code: string;
}

export type VideoProvider = 'auto' | 'youtube' | 'vimeo' | 'generic';
export type VideoAspectRatio = '16:9' | '4:3' | '1:1';

export interface RawHtmlProps extends HideOnProps, BoxStyleProps {
  html: string;
  sanitize?: boolean;
}

export interface RawJsProps extends HideOnProps, BoxStyleProps {
  script: string;
  runOnce?: boolean;
}

export interface VideoProps extends HideOnProps, BoxStyleProps {
  url: string;
  provider?: VideoProvider;
  aspectRatio?: VideoAspectRatio;
  title?: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  maxWidth?: number | ResponsiveProp<number>;
  align?: ImageAlign | ResponsiveProp<ImageAlign>;
}

export interface ContentSliderProps extends HideOnProps, BoxStyleProps {
  slides: Slot;
  slidesPerView?: number | ResponsiveProp<number>;
  gap?: number | ResponsiveProp<number>;
  autoplay?: boolean;
  intervalMs?: number;
  showArrows?: boolean;
  showDots?: boolean;
  equalHeight?: boolean;
}

export interface SlideProps extends HideOnProps, BoxStyleProps {
  content: Slot;
}

export type ImageSliderTitlePlacement =
  | 'none'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface ImageSliderItem {
  /** Nested image fields for the editor (conditional source UI). Flat fields kept in sync via resolveData. */
  image?: {
    imageSource?: ImageSourceKind;
    src?: string;
    assetId?: string;
  };
  imageSource?: ImageSourceKind;
  src: string;
  assetId?: string;
  title?: string;
  titlePlacement?: ImageSliderTitlePlacement;
  titleBackground?: string;
  titleColor?: string;
  titleBorderColor?: string;
  titleBorderWidth?: number;
  titleBorderRadius?: CornerRadius;
  titlePaddingPx?: number;
}

export interface ImageSliderProps extends HideOnProps, BoxStyleProps {
  items: ImageSliderItem[];
  slidesPerView?: number | ResponsiveProp<number>;
  gap?: number | ResponsiveProp<number>;
  autoplay?: boolean;
  intervalMs?: number;
  showArrows?: boolean;
  showDots?: boolean;
  equalHeight?: boolean;
}

export interface TabItem {
  label: string;
  content: string;
}

export interface TabsProps extends HideOnProps, BoxStyleProps {
  items: TabItem[];
  defaultTab?: number;
  variant?: 'underline' | 'pills' | 'boxed';
  align?: 'start' | 'center' | 'stretch';
}

export interface AccordionItem {
  title: string;
  content: string;
}

export interface AccordionProps extends HideOnProps, BoxStyleProps {
  items: AccordionItem[];
  allowMultiple?: boolean;
  defaultOpen?: number[];
  iconPosition?: 'start' | 'end';
  variant?: 'default' | 'flush' | 'bordered';
}

export type ProductSource = 'manual' | 'category' | 'query';

export interface CmsProductCardProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  productSlug: string;
  showPrice?: boolean;
  showSku?: boolean;
  showStock?: boolean;
  imageRatio?: 'square' | '4:3' | '16:9' | 'auto';
  imageObjectFit?: 'cover' | 'contain' | 'fill' | 'none';
  /** Max card width in px; omit or 0 = stretch to container. */
  maxWidthPx?: number | ResponsiveProp<number>;
  /** Fixed media height in px; when set, overrides aspect-ratio from imageRatio. */
  imageHeightPx?: number | ResponsiveProp<number>;
  variant?: 'default' | 'compact' | 'horizontal';
  ctaLabel?: string;
}

export interface ProductGridProps extends HideOnProps, BoxStyleProps {
  source?: ProductSource;
  productSlugs?: string[];
  categorySlug?: string;
  searchQuery?: string;
  limit?: number;
  columns?: number | ResponsiveProp<number>;
  gap?: number | ResponsiveProp<number>;
  view?: 'grid' | 'list' | ResponsiveProp<'grid' | 'list'>;
  equalItemHeight?: boolean;
}

export interface ProductSliderProps extends HideOnProps, BoxStyleProps {
  source?: ProductSource;
  productSlugs?: string[];
  categorySlug?: string;
  searchQuery?: string;
  limit?: number;
  slidesPerView?: number | ResponsiveProp<number>;
  gap?: number | ResponsiveProp<number>;
  autoplay?: boolean;
  intervalMs?: number;
  showArrows?: boolean;
  showDots?: boolean;
  equalHeight?: boolean;
}

export type CategorySelectionMode = 'all' | 'manual' | 'childrenOf';

export interface CategoryListProps extends HideOnProps, BoxStyleProps {
  selectionMode?: CategorySelectionMode;
  categorySlugs?: string[];
  parentSlug?: string;
  layout?: 'list' | 'inline' | 'chips';
  showCounts?: boolean;
  maxDepth?: number;
}

export interface CategoryGridProps extends HideOnProps, BoxStyleProps {
  selectionMode?: CategorySelectionMode;
  categorySlugs?: string[];
  parentSlug?: string;
  columns?: number | ResponsiveProp<number>;
  gap?: number | ResponsiveProp<number>;
  showImage?: boolean;
  cardStyle?: 'overlay' | 'stacked' | 'minimal';
  showCounts?: boolean;
  maxDepth?: number;
  equalItemHeight?: boolean;
}

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  link?: string;
}

export type MapProvider = 'leaflet' | 'google';

export interface MapProps extends HideOnProps, BoxStyleProps {
  provider?: MapProvider;
  height?: number | ResponsiveProp<number>;
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  markers?: MapMarker[];
  googleApiKey?: string;
}

export interface SpacerProps extends HideOnProps {
  heightPx?: number | ResponsiveProp<number>;
  showDivider?: boolean;
  dividerColor?: string;
}

export interface FeatureListItem {
  icon?: string;
  title: string;
  description?: string;
}

export interface FeatureListProps extends HideOnProps, BoxStyleProps {
  items: FeatureListItem[];
  columns?: number | ResponsiveProp<number>;
  gap?: number | ResponsiveProp<number>;
  iconColor?: string;
  iconSize?: number;
  align?: ImageAlign;
}

export interface HeroProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  heading: string;
  subtitle?: string;
  buttonLabel?: string;
  buttonLinkType?: ButtonLinkType;
  buttonLinkSlug?: string;
  buttonHref?: string;
  buttonTarget?: ButtonTarget;
  buttonVariant?: ButtonVariant | ResponsiveProp<ButtonVariant>;
  buttonBackgroundColor?: string;
  buttonTextColor?: string;
  minHeightPx?: number | ResponsiveProp<number>;
  contentAlign?: ImageAlign;
  overlayOpacity?: number;
  textColor?: string;
}

export interface LogoStripItem {
  /** Nested image control (URL vs asset library) — same pattern as Image Slider. */
  image?: {
    imageSource?: ImageSourceKind;
    src?: string;
    assetId?: string;
  };
  imageSource?: ImageSourceKind;
  src?: string;
  assetId?: string;
  alt?: string;
  href?: string;
}

export interface LogoStripProps extends HideOnProps, BoxStyleProps {
  items: LogoStripItem[];
  gap?: number;
  logoMaxHeightPx?: number;
  grayscale?: boolean;
  align?: ImageAlign;
}

export interface TestimonialProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  quote: string;
  author?: string;
  role?: string;
  /** Avatar image source — same pattern as Image (`url` | `library`). */
  avatarSource?: ImageSourceKind;
  avatarUrl?: string;
  avatarAssetId?: string;
}

export interface StatsItem {
  value: string;
  label: string;
}

export interface StatsProps extends HideOnProps, BoxStyleProps {
  items: StatsItem[];
  columns?: number | ResponsiveProp<number>;
  gap?: number;
  align?: ImageAlign;
  valueColor?: string;
}

export interface AnnouncementBarProps extends HideOnProps {
  text: string;
  href?: string;
  backgroundColor?: string;
  textColor?: string;
}

export interface SimpleTableHeader {
  label: string;
}

export interface SimpleTableCell {
  value: string;
}

export interface SimpleTableRow {
  cells: SimpleTableCell[];
}

export interface SimpleTableProps extends HideOnProps, BoxStyleProps {
  /** @deprecated legacy pipe-separated headers — migrated in resolveData */
  headers?: string | SimpleTableHeader[];
  /** @deprecated legacy pipe-separated rows — migrated in resolveData */
  rows?: string | SimpleTableRow[];
  columns?: SimpleTableHeader[];
  tableRows?: SimpleTableRow[];
  striped?: boolean;
}

export interface NewsletterSignupProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  heading?: string;
  description?: string;
  placeholder?: string;
  buttonLabel?: string;
  /** Form action URL (newsletter endpoint or external). */
  actionUrl?: string;
}

export interface ContactFormEmbedProps extends HideOnProps, BoxStyleProps {
  heading?: string;
  description?: string;
  /** External form embed URL (iframe) or leave empty for mailto fallback. */
  embedUrl?: string;
  mailto?: string;
  heightPx?: number;
}
