// @endora-commerce/cms-components — shared Page Builder components for the CMS module
// (feature 014).

import type { ComponentConfig, Config } from '@puckeditor/core';
import { definePageBuilderComponent, ownerOf, withHideOn } from '@endora-commerce/page-builder-core';
import { Accordion } from './components/Accordion.js';
import { AnnouncementBar } from './components/AnnouncementBar.js';
import { BackgroundPanel } from './components/BackgroundPanel.js';
import { Button } from './components/Button.js';
import { CarouselImage } from './components/CarouselImage.js';
import { CarouselSplit } from './components/CarouselSplit.js';
import { CategoryGrid } from './components/CategoryGrid.js';
import { CategoryList } from './components/CategoryList.js';
import { Column } from './components/Column.js';
import { ContactFormEmbed } from './components/ContactFormEmbed.js';
import { ContactForm } from './components/ContactForm.js';
import { ContentSlider } from './components/ContentSlider.js';
import { CtaCard } from './components/CtaCard.js';
import { DownloadTile } from './components/DownloadTile.js';
import { FeatureList } from './components/FeatureList.js';
import { Heading } from './components/Heading.js';
import { Hero } from './components/Hero.js';
import { Icons } from './components/Icons.js';
import { Image } from './components/Image.js';
import { InsertBlock } from './components/InsertBlock.js';
import { InsertTemplate } from './components/InsertTemplate.js';
import { LatestPosts } from './components/LatestPosts.js';
import { LinkList } from './components/LinkList.js';
import { LinkTile } from './components/LinkTile.js';
import { LogoStrip } from './components/LogoStrip.js';
import { Map } from './components/Map.js';
import { MediaText } from './components/MediaText.js';
import { MissingComponentPlaceholder } from './components/MissingComponentPlaceholder.js';
import { NewsletterSignup } from './components/NewsletterSignup.js';
import { PageNavigation } from './components/PageNavigation.js';
import { Signup as NewsletterSignupBlock } from './components/NewsletterSignupForm.js';
import { ProductCard } from './components/ProductCard.js';
import { ProductGrid } from './components/ProductGrid.js';
import { ProductSlider } from './components/ProductSlider.js';
import { RawHtml } from './components/RawHtml.js';
import { RawJs } from './components/RawJs.js';
import { RichContent } from './components/RichContent.js';
import { Row } from './components/Row.js';
import { Section, SECTION_RESPONSIVE_FIELDS } from './components/SectionBlock.js';
import { SectionGroup, SECTION_GROUP_RESPONSIVE_FIELDS } from './components/SectionGroupBlock.js';
import { SimpleTable } from './components/SimpleTable.js';
import { Slide } from './components/Slide.js';
import { Social } from './components/Social.js';
import { Spacer } from './components/Spacer.js';
import { Statement } from './components/Statement.js';
import { Stats } from './components/Stats.js';
import { Tabs } from './components/Tabs.js';
import { Testimonial } from './components/Testimonial.js';
import { Text } from './components/Text.js';
import { Video } from './components/Video.js';

export * from './components/Accordion.js';
export * from './components/AnnouncementBar.js';
export * from './components/BackgroundPanel.js';
export * from './components/Button.js';
export * from './components/CarouselImage.js';
export * from './components/CarouselSplit.js';
export * from './components/CategoryGrid.js';
export * from './components/CategoryList.js';
export * from './components/Column.js';
export * from './components/ContactFormEmbed.js';
// Feature 169 — the contact form that e-mails the shop.
export * from './components/ContactForm.js';
export * from './components/ContentSlider.js';
export * from './components/CtaCard.js';
export * from './components/DownloadTile.js';
export * from './components/FeatureList.js';
export * from './components/Heading.js';
export * from './components/Hero.js';
export * from './components/Icons.js';
export * from './components/icon-catalog.js';
export * from './components/IconPickerField.js';
export * from './components/Image.js';
export * from './components/InsertBlock.js';
export * from './components/InsertTemplate.js';
export * from './components/LatestPosts.js';
export * from './components/LinkList.js';
export * from './components/LinkTile.js';
export * from './components/LogoStrip.js';
export * from './components/Map.js';
export * from './components/MediaText.js';
export * from './components/MissingComponentPlaceholder.js';
export * from './components/NewsletterSignup.js';
export * from './components/NewsletterSignupForm.js';
export * from './components/PageNavigation.js';
export * from './components/page-navigation-spy.js';
export * from './components/ProductCard.js';
export * from './components/ProductGrid.js';
export * from './components/ProductSlider.js';
export * from './components/RawHtml.js';
export * from './components/RawJs.js';
export * from './components/RichContent.js';
export { RichContentEditorField } from './components/RichContentEditorField.js';
export {
  coerceRichContentProps,
  defaultRichContent,
  emphasisMark,
  htmlFromTiptap,
  richContentExtensions,
  sanitizeRichHtml,
} from './components/rich-content-shared.js';
export * from './components/Row.js';
export * from './components/SimpleTable.js';
export * from './components/Slide.js';
export * from './components/Social.js';
export * from './components/social-networks.js';
export * from './components/Spacer.js';
export * from './components/Statement.js';
export * from './components/Stats.js';
export * from './components/Tabs.js';
export * from './components/Testimonial.js';
export * from './components/Text.js';
export * from './components/Video.js';
export * from './components/CmsPageContainer.js';
export * from './components/render-context.js';
export * from './components/catalog-preview-context.js';
export * from './components/box-styles.js';
export * from './schema/component-types.js';
export * from './schema/catalog-types.js';
export * from './schema/blog-types.js';
export * from './utils/walk-asset-ids.js';
// Feature 163 — the shared renderers of `ButtonSpec`, `ResponsiveImage`,
// `InlineRichText` and `LinkValue` (research R-9 to R-11).
export * from './components/ButtonView.js';
export * from './components/InlineRich.js';
export * from './components/Picture.js';
export * from './components/Section.js';
export * from './components/SectionBlock.js';
export * from './components/SectionGroupBlock.js';
export * from './hooks/use-breakpoint-video.js';
// Restrained motion (feature 163, US10, research R-21): the entrance reveal and its word split.
export * from './hooks/use-reveal.js';
export * from './utils/split-words.js';
export * from './utils/color-value.js';
export * from './utils/link-href.js';
export * from './utils/media-source.js';
// Feature 163 — brand tokens as `--cmsb-*` CSS, for the storefront's
// `<style id="cmsb">` and the admin preview iframe (research R-3, R-4).
export {
  brandTokensToCss,
  type BrandCss,
  type BrandCssOptions,
  type BrandFontLink,
} from './brand/brand-css.js';
// Feature 163 — the inline rich-text field of short headings (research R-10).
export { InlineRichTextEditor, inlineRichTextExtensions } from './components/InlineRichTextEditor.js';
export type { InlineRichTextEditorProps } from './components/InlineRichTextEditor.js';
export * from './fields/inline-rich-text-field.js';
// R20E (T296): the button look fields, shared by every embedded button's editor (the admin's ButtonSpec field).
export { BUTTON_LOOK_FIELDS } from './fields/shared-fields.js';

/**
 * The CMS renderer map — **the React half only**, keyed by namespaced block name
 * (feature 096, T301; `contracts/block-definition.md` §4.3).
 *
 * **The `categories` block is gone and nothing in this package replaces it.**
 * A section is declared by the module whose blocks occupy it and is served,
 * merged across the present modules, by
 * `GET /api/v1/admin/cms/page-builder/config` — so a module contributing a
 * block into a section no longer has to edit a map in a package it does not
 * own, which is FR-009 and the shape feature 091 removed from the admin. The
 * eight CMS sections it listed are `cms`' `blockCategories`, and the five
 * Catalog entries are `catalog`'s.
 *
 * `defaultExpanded` went with it and no schema field replaces it (D-11).
 * Measured on Puck `0.20.2`: `ComponentList` reads `{ expanded = true }`, so
 * `defaultExpanded: true` — which is what all four sections wrote — is
 * indistinguishable from omitting the field. Deleting it is behaviour-preserving.
 */
export const defaultPageBuilderConfig: Config = {
  components: {
    // Feature 163, plan § Owner ruling 2026-10-23: the one block carrying section settings, top level only.
    'cms.Section': definePageBuilderComponent({
      ...(Section as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [...SECTION_RESPONSIVE_FIELDS],
    }),
    // T158, plan § Owner ruling 2026-10-26: the container of Sections, top level only.
    'cms.SectionGroup': definePageBuilderComponent({
      ...(SectionGroup as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [...SECTION_GROUP_RESPONSIVE_FIELDS],
    }),
    'cms.Row': definePageBuilderComponent({
      ...(Row as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [
        'contentMaxWidth',
        'customMaxWidthPx',
        'contentPosition',
        'minHeight',
        'gap',
        'rowGap',
        'verticalAlign',
        'margin',
        'padding',
        'border',
      ],
    }),
    'cms.Column': definePageBuilderComponent({
      ...(Column as unknown as ComponentConfig),
      contexts: ['cms'],
      // T159: the column's order in the row per breakpoint; T165: its placement in the row's grid.
      responsiveFields: ['span', 'stackOrder', 'rowSpan', 'columnStart', 'rowStart', 'margin', 'padding', 'border', 'outsetPx'],
    }),
    'cms.Text': definePageBuilderComponent({
      ...(Text as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['fontSize', 'fontWeight', 'textAlign', 'lineHeight', 'textMaxWidth', 'textMaxWidthPx', 'margin', 'padding', 'border'],
    }),
    'cms.RichContent': definePageBuilderComponent({
      ...(withHideOn(RichContent as unknown as ComponentConfig) as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['textMaxWidth', 'textMaxWidthPx', 'margin', 'padding', 'border', 'textSize', 'textSizePx', 'listLineHeight'],
    }),
    'cms.Heading': definePageBuilderComponent({
      ...(Heading as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['size', 'fontSize', 'fontWeight', 'align', 'lineHeight', 'margin', 'padding', 'border', 'textMaxWidth', 'textMaxWidthPx'],
    }),
    'cms.Button': definePageBuilderComponent({
      ...(Button as unknown as ComponentConfig),
      contexts: ['cms'],
      // R19B (T246): an icon-only button's size per breakpoint.
      responsiveFields: ['button', 'align', 'fullWidth', 'margin', 'padding', 'border'],
    }),
    'cms.Image': definePageBuilderComponent({
      ...(Image as unknown as ComponentConfig),
      contexts: ['cms'],
      // R19B (T251): the caption's placement, size and alignment per breakpoint.
      responsiveFields: ['widthMode', 'widthPx', 'ratio', 'align', 'captionPlacement', 'captionSize', 'captionSizePx', 'captionAlign', 'captionMaxWidthPx', 'margin', 'padding', 'border'],
    }),
    'cms.Icons': definePageBuilderComponent({
      ...(Icons as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['align', 'margin', 'padding', 'border'],
    }),
    'cms.Social': definePageBuilderComponent({
      ...(Social as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['align', 'margin', 'padding', 'border', 'gap', 'gapPx'],
    }),
    'cms.Spacer': definePageBuilderComponent({
      ...(Spacer as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['heightPx'],
    }),
    'cms.FeatureList': definePageBuilderComponent({
      ...(FeatureList as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [
        'headingSize',
        'headingSizePx',
        'headingMaxWidth',
        'headingMaxWidthPx',
        'columns',
        'gap',
        'gapPx',
        'titleSize',
        'titleSizePx',
        'margin',
        'padding',
        'border',
        'headingWeight',
        'align',
        'titleWeight',
        // R19A (T224, T225).
        'titleLineHeight',
        'bodySize',
        'bodySizePx',
        'bodyLineHeight',
        // R20F (T317).
        'rowGapPx',
        'listLineHeight',
        // R22I.
        'iconPosition',
      ],
    }),
    'cms.Hero': definePageBuilderComponent({
      ...(Hero as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [
        'titleSize',
        'titleSizePx',
        'titleMaxWidth',
        'titleMaxWidthPx',
        'subheadingSize',
        'subheadingSizePx',
        'statementSize',
        'statementSizePx',
        'buttons',
        'buttonsFullWidth',
        'minHeight',
        'minHeightPx',
        'gaps',
        'margin',
        'padding',
        'border',
        'titleWeight',
        'align',
        // R19A (T227–T229).
        'subheadingLineHeight',
        'subheadingMaxWidth',
        'subheadingMaxWidthPx',
        'statementLineHeight',
        'statementMaxWidth',
        'statementMaxWidthPx',
        'bodySize',
        'bodySizePx',
        'bodyLineHeight',
        'bodyMaxWidth',
        'bodyMaxWidthPx',
        'gapsPx',
        'mediaSpace',
        'mediaSpacePx',
        // R20E.
        'titleLineHeight',
        'eyebrowSizePx',
        'eyebrowLineHeight',
        'proofCaptionPlacement',
        'proofCaptionMaxWidthPx',
        // R23 (T436).
        'eyebrowSize',
      ],
    }),
    // Feature 163 (T047) — the composition blocks of US3 (contracts/blocks.md).
    'cms.MediaText': definePageBuilderComponent({
      ...(MediaText as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [
        'headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'featureTitleSize', 'featureTitleSizePx', 'buttons', 'buttonsFullWidth', 'headingWeight', 'featureTitleWeight',
        // R20F (T315): the text size.
        'bodySize', 'bodySizePx', 'bodyLineHeight', 'headingLineHeight',
        // R22I.
        'columnGapPx', 'featureBodySize', 'featureBodySizePx',
      ],
    }),
    'cms.BackgroundPanel': definePageBuilderComponent({
      ...(BackgroundPanel as unknown as ComponentConfig),
      contexts: ['cms'],
      // R20F (T316): the text box's margin and padding.
      responsiveFields: ['headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'buttons', 'buttonsFullWidth', 'minHeight', 'headingWeight'],
    }),
    'cms.CtaCard': definePageBuilderComponent({
      ...(CtaCard as unknown as ComponentConfig),
      contexts: ['cms'],
      // R20F (T318): the card's padding and the image's columns.
      responsiveFields: ['headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'buttons', 'buttonsFullWidth', 'headingWeight', 'imageColumns', 'bodySize', 'bodySizePx', 'textMaxWidth', 'textMaxWidthPx'],
    }),
    'cms.Statement': definePageBuilderComponent({
      ...(Statement as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [
        'headingSize',
        'headingSizePx',
        'textMaxWidth',
        'textMaxWidthPx',
        'headingWeight',
        'align',
        // R19A (T231).
        'minHeight',
        'minHeightPx',
        'headingLineHeight',
        'bodySize',
        'bodySizePx',
        'bodyLineHeight',
      ],
    }),
    'cms.LogoStrip': definePageBuilderComponent({
      ...(LogoStrip as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border', 'align', 'gap', 'gapPx'],
    }),
    'cms.Testimonial': definePageBuilderComponent({
      ...(Testimonial as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border', 'quoteSize', 'quoteSizePx'],
    }),
    'cms.Stats': definePageBuilderComponent({
      ...(Stats as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [
        'headingSize',
        'headingSizePx',
        'headingMaxWidth',
        'headingMaxWidthPx',
        'columns',
        'gap',
        'gapPx',
        'valueSize',
        'valueSizePx',
        'margin',
        'padding',
        'border',
        'headingWeight',
        'align',
        // R19A (T235).
        'labelSize',
        'labelSizePx',
        // R20F (T319).
        'labelLineHeight',
        // R22I.
        'columnGapPx', 'valueLineHeight',
      ],
    }),
    'cms.AnnouncementBar': definePageBuilderComponent({
      ...(AnnouncementBar as unknown as ComponentConfig),
      contexts: ['cms'],
    }),
    'cms.SimpleTable': definePageBuilderComponent({
      ...(SimpleTable as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.NewsletterSignup': definePageBuilderComponent({
      ...(NewsletterSignup as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    // Feature 163 (T076) — declared by the `newsletter` manifest, rendered from here (research R-17).
    'newsletter.Signup': definePageBuilderComponent({
      ...(NewsletterSignupBlock as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [],
    }),
    'cms.ContactFormEmbed': definePageBuilderComponent({
      ...(ContactFormEmbed as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    // Feature 169 (`specs/169-page-builder-contact-form/` data-model §3).
    'cms.ContactForm': definePageBuilderComponent({
      ...(ContactForm as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.Video': definePageBuilderComponent({
      ...(Video as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['aspectRatio', 'maxWidth', 'align', 'margin', 'padding', 'border'],
    }),
    'cms.Map': definePageBuilderComponent({
      ...(Map as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['height', 'margin', 'padding', 'border'],
    }),
    'catalog.ProductCard': definePageBuilderComponent({
      ...(ProductCard as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['maxWidthPx', 'imageHeightPx', 'margin', 'padding', 'border'],
    }),
    'catalog.ProductGrid': definePageBuilderComponent({
      ...(ProductGrid as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'columns', 'gap', 'view', 'margin', 'padding', 'border', 'equalItemHeight', 'gapPx', 'headingWeight', 'leadSize', 'leadSizePx', 'headingLineHeight'],
    }),
    'catalog.ProductSlider': definePageBuilderComponent({
      ...(ProductSlider as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'slidesPerView', 'gap', 'gapPx', 'controlsPlacement', 'controlsAlign', 'margin', 'padding', 'border', 'headingWeight', 'leadSize', 'leadSizePx', 'headingLineHeight'],
    }),
    'catalog.CategoryList': definePageBuilderComponent({
      ...(CategoryList as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'catalog.CategoryGrid': definePageBuilderComponent({
      ...(CategoryGrid as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['columns', 'gap', 'margin', 'padding', 'border', 'equalItemHeight', 'gapPx'],
    }),
    // Feature 163 (T072) — rows of a title, a description and a button (FR-028).
    'cms.LinkList': definePageBuilderComponent({
      ...(LinkList as unknown as ComponentConfig),
      contexts: ['cms'],
      // R19A (T236): the row titles' size and weight.
      responsiveFields: ['headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'headingWeight', 'titleSize', 'titleSizePx', 'titleLineHeight'],
    }),
    // Feature 163 (T069) — declared by the `blog` manifest, rendered from here (research R-15).
    'blog.LatestPosts': definePageBuilderComponent({
      ...(LatestPosts as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [
        'headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'columns', 'slidesPerView', 'gap', 'gapPx', 'controlsPlacement', 'controlsAlign',
        // T189: the post card's look, the lead's size and the header button's place and width, per breakpoint.
        'cardPadding', 'cardPaddingPx', 'cardTextPadding', 'cardTextPaddingPx', 'imageRatio', 'cardTitleSize', 'cardTitleSizePx', 'cardTitleWeight',
        'leadSize', 'leadSizePx', 'headerButtonPlacement', 'headerButtonFullWidth',
        'headingWeight',
        // R22I.
        'headingLineHeight',
      ],
    }),
    // Feature 163 (T054) — the Carousel and its item blocks (research R-12).
    'cms.ContentSlider': definePageBuilderComponent({
      ...(ContentSlider as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: [
        'headingSize',
        'headingSizePx',
        'headingMaxWidth',
        'headingMaxWidthPx',
        'slidesPerView',
        'gap',
        'gapPx',
        // Feature 163, T129–T130: the arrow placement and the grid's columns per breakpoint.
        'controlsPlacement',
        // Feature 163, T147: the alignment of the controls below the track.
        'controlsAlign',
        'columns',
        'margin',
        'padding',
        'border',
        'headingWeight',
        // R22I.
        'headingLineHeight',
      ],
    }),
    'cms.Slide': definePageBuilderComponent({
      ...(Slide as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.CarouselImage': definePageBuilderComponent({
      ...(CarouselImage as unknown as ComponentConfig),
      contexts: ['cms'],
      // Feature 163, T144: the caption's size per breakpoint; T188: its weight.
      // R19B (T249, T250): the caption's padding and the read-more label's size per breakpoint.
      responsiveFields: ['captionSize', 'captionSizePx', 'captionWeight'],
    }),
    'cms.CarouselSplit': definePageBuilderComponent({
      ...(CarouselSplit as unknown as ComponentConfig),
      contexts: ['cms'],
      // R20F (T311, T312): the title's and the text's type, the space after a hanging icon.
      responsiveFields: [
        'buttons', 'buttonsFullWidth',
        'titleSize', 'titleSizePx', 'titleLineHeight', 'bodySize', 'bodySizePx', 'bodyLineHeight',
        // R22I.
        'columnGapPx',
      ],
    }),
    'cms.LinkTile': definePageBuilderComponent({
      ...(LinkTile as unknown as ComponentConfig),
      contexts: ['cms'],
      // Feature 163, T130: the image ratio per breakpoint; T144: the title's and the label's size; T181: their resting colours; T188: their weights.
      responsiveFields: ['ratio', 'titleSize', 'titleSizePx', 'titleWeight', 'titleColor', 'labelSize', 'labelSizePx', 'labelWeight', 'labelColor'],
    }),
    'cms.DownloadTile': definePageBuilderComponent({
      ...(DownloadTile as unknown as ComponentConfig),
      contexts: ['cms'],
      // R19B (T247, T248): the card's padding, the title's size and the icon button's size per breakpoint.
      responsiveFields: ['titleSize', 'titleSizePx'],
    }),
    'cms.Tabs': definePageBuilderComponent({
      ...(Tabs as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['tabSize', 'panelGap', 'panelGapPx', 'margin', 'padding', 'border', 'align'],
    }),
    // Feature 169 (US5): links to sections of the same page, with a scroll spy.
    'cms.PageNavigation': definePageBuilderComponent({
      ...(PageNavigation as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['align', 'margin', 'padding', 'border'],
    }),
    'cms.Accordion': definePageBuilderComponent({
      ...(Accordion as unknown as ComponentConfig),
      contexts: ['cms'],
      // Feature 163, T175: the title padding; T182: the space above an open panel and between items;
      // T185: the title weight; T186: the space below an open panel and after an open item.
      responsiveFields: [
        'titleSize', 'titleSizePx', 'titleWeight', 'titlePadding', 'titlePaddingPx', 'panelGap', 'panelGapPx', 'itemGap', 'itemGapPx',
        'panelPaddingBottom', 'panelPaddingBottomPx', 'openItemGap', 'openItemGapPx', 'margin', 'padding', 'border', 'titleLineHeight',
      ],
    }),
    'cms.RawHtml': definePageBuilderComponent({
      ...(RawHtml as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.RawJs': definePageBuilderComponent({
      ...(RawJs as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.InsertBlock': definePageBuilderComponent({
      ...(withHideOn(InsertBlock as unknown as ComponentConfig) as ComponentConfig),
      contexts: ['cms'],
    }),
    'cms.InsertTemplate': definePageBuilderComponent({
      ...(withHideOn(InsertTemplate as unknown as ComponentConfig) as ComponentConfig),
      contexts: ['cms'],
    }),
  },
};

/**
 * Builds a per-name placeholder ComponentConfig for a Page Builder
 * component whose React renderer this bundle does not carry — because the
 * descriptor declares a block no local renderer answers, because the owning
 * module is switched off or not installed, or because the name is one the
 * block-name migration did not recognise and left alone. FR-020 says those are
 * one path, and this is it.
 *
 * `visible` is the surface's answer, not the placeholder's. On an editing
 * surface an operator has to be told **why** a block vanished, so the
 * placeholder renders its note; on a customer-facing one it renders an empty
 * span, which is what `MissingComponentPlaceholder` decides for itself from the
 * `?cms_admin=1` preview parameter when nothing says otherwise. Passing it
 * explicitly is what makes the admin case work at all: nothing in this
 * repository has ever set that query parameter, so every placeholder the editor
 * merged before feature 096's T602 rendered as nothing — a block that has lost
 * its module and a block that has been deleted looked identical on the canvas.
 */
export function makeMissingComponentConfig(
  componentName: string,
  ownerModule: string,
  options: { readonly visible?: boolean } = {},
): ComponentConfig {
  const forced = options.visible === true ? { isAdminPreview: true } : {};
  return {
    label: `${componentName} (missing renderer)`,
    fields: MissingComponentPlaceholder.fields,
    defaultProps: { componentName, ownerModule, ...forced },
    render: (props) =>
      MissingComponentPlaceholder.render({
        componentName,
        ownerModule,
        ...(props as Record<string, unknown>),
        ...forced,
      } as never),
  } as ComponentConfig;
}

/**
 * The editor's degradation merge — feature 096, T602 (FR-019, FR-020).
 *
 * Give every one of `storedNames` that `config` cannot render a visible,
 * data-preserving placeholder, and change nothing else.
 *
 * ## Why the stored document is a source of names at all
 *
 * The editor already merged a placeholder for a name the *descriptor* declares
 * with no local renderer. That population does not contain the case
 * Constitution XVII produces: a switched-off module's blocks are filtered out
 * of the descriptor (FR-010), so after a deactivation the name on an operator's
 * page is in neither the renderer map nor the descriptor and the merge saw it
 * nowhere. The document is the one place it is still written down — which is
 * the whole point of namespacing the persisted name in the first place.
 *
 * ## It takes names, not the document
 *
 * The caller walks the document with `countComponentNames`, the structural
 * walk of the components a document places (feature 163, T197: not
 * `countBlockNames`, which also offers a rich text's TipTap nodes). That is
 * not ceremony: a React caller
 * needs a **stable** memo key, and the set of names a document carries changes
 * far less often than the document does — a keystroke inside a text block moves
 * the document and not the names, and a merge keyed on the document would
 * rebuild the whole Puck config on every one.
 *
 * ## What it deliberately does not do
 *
 * It adds **no category entry**. A degraded block must stay visible and
 * editable where it already is; it is not a block anyone may insert, and the
 * palette is the surface that answers the second question.
 *
 * It does not decide **presence**. Which names this config keys is the caller's
 * answer, arrived at from the descriptor; this function only says what happens
 * to a stored name that answer does not cover — which is why one unknown name
 * behaves identically whatever made it unknown.
 */
export function withMissingBlockPlaceholders(
  config: Config,
  storedNames: Iterable<string>,
): Config {
  const components = (config.components ?? {}) as Record<string, ComponentConfig>;
  const missing = [...new Set(storedNames)].filter((name) => !(name in components));
  if (missing.length === 0) return config;

  const merged: Record<string, ComponentConfig> = { ...components };
  for (const name of missing) {
    // `ownerOf` answers `null` for a name that states no owner — an
    // unrecognised one the migration left byte-identical. The placeholder then
    // names the block and has no module to name, which is the one thing that
    // differs between FR-020's three causes and is a property of the name
    // rather than of the path it took.
    merged[name] = makeMissingComponentConfig(name, ownerOf(name) ?? '', { visible: true });
  }
  return { ...config, components: merged } as Config;
}
