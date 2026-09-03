// @endora-commerce/cms-components — shared Page Builder components for the CMS module
// (feature 014).

import type { ComponentConfig, Config } from '@measured/puck';
import { definePageBuilderComponent, withHideOn } from '@endora-commerce/page-builder-core';
import { Accordion } from './components/Accordion.js';
import { AnnouncementBar } from './components/AnnouncementBar.js';
import { Button } from './components/Button.js';
import { CategoryGrid } from './components/CategoryGrid.js';
import { CategoryList } from './components/CategoryList.js';
import { Column } from './components/Column.js';
import { ContactFormEmbed } from './components/ContactFormEmbed.js';
import { ContentSlider } from './components/ContentSlider.js';
import { FeatureList } from './components/FeatureList.js';
import { Heading } from './components/Heading.js';
import { Hero } from './components/Hero.js';
import { Icons } from './components/Icons.js';
import { Image } from './components/Image.js';
import { ImageSlider } from './components/ImageSlider.js';
import { InsertBlock } from './components/InsertBlock.js';
import { InsertTemplate } from './components/InsertTemplate.js';
import { LogoStrip } from './components/LogoStrip.js';
import { Map } from './components/Map.js';
import { MissingComponentPlaceholder } from './components/MissingComponentPlaceholder.js';
import { NewsletterSignup } from './components/NewsletterSignup.js';
import { ProductCard } from './components/ProductCard.js';
import { ProductGrid } from './components/ProductGrid.js';
import { ProductSlider } from './components/ProductSlider.js';
import { RawHtml } from './components/RawHtml.js';
import { RawJs } from './components/RawJs.js';
import { RichContent } from './components/RichContent.js';
import { Row } from './components/Row.js';
import { SimpleTable } from './components/SimpleTable.js';
import { Slide } from './components/Slide.js';
import { Social } from './components/Social.js';
import { Spacer } from './components/Spacer.js';
import { Stats } from './components/Stats.js';
import { Tabs } from './components/Tabs.js';
import { Testimonial } from './components/Testimonial.js';
import { Text } from './components/Text.js';
import { Video } from './components/Video.js';

export * from './components/Accordion.js';
export * from './components/AnnouncementBar.js';
export * from './components/Button.js';
export * from './components/CategoryGrid.js';
export * from './components/CategoryList.js';
export * from './components/Column.js';
export * from './components/ContactFormEmbed.js';
export * from './components/ContentSlider.js';
export * from './components/FeatureList.js';
export * from './components/Heading.js';
export * from './components/Hero.js';
export * from './components/Icons.js';
export * from './components/icon-catalog.js';
export * from './components/IconPickerField.js';
export * from './components/Image.js';
export * from './components/ImageSlider.js';
export * from './components/InsertBlock.js';
export * from './components/InsertTemplate.js';
export * from './components/LogoStrip.js';
export * from './components/Map.js';
export * from './components/MissingComponentPlaceholder.js';
export * from './components/NewsletterSignup.js';
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
export * from './utils/walk-asset-ids.js';

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
      responsiveFields: ['span', 'margin', 'padding', 'border'],
    }),
    'cms.Text': definePageBuilderComponent({
      ...(Text as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['fontSize', 'fontWeight', 'textAlign', 'lineHeight', 'margin', 'padding', 'border'],
    }),
    'cms.RichContent': definePageBuilderComponent({
      ...(withHideOn(RichContent as unknown as ComponentConfig) as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.Heading': definePageBuilderComponent({
      ...(Heading as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['fontSize', 'fontWeight', 'textAlign', 'lineHeight', 'margin', 'padding', 'border'],
    }),
    'cms.Button': definePageBuilderComponent({
      ...(Button as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['variant', 'margin', 'padding', 'border'],
    }),
    'cms.Image': definePageBuilderComponent({
      ...(Image as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['widthMode', 'widthPx', 'align', 'margin', 'padding', 'border'],
    }),
    'cms.Icons': definePageBuilderComponent({
      ...(Icons as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['align', 'margin', 'padding', 'border'],
    }),
    'cms.Social': definePageBuilderComponent({
      ...(Social as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['align', 'margin', 'padding', 'border'],
    }),
    'cms.Spacer': definePageBuilderComponent({
      ...(Spacer as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['heightPx'],
    }),
    'cms.FeatureList': definePageBuilderComponent({
      ...(FeatureList as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['columns', 'gap', 'margin', 'padding', 'border'],
    }),
    'cms.Hero': definePageBuilderComponent({
      ...(Hero as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['minHeightPx', 'margin', 'padding', 'border'],
    }),
    'cms.LogoStrip': definePageBuilderComponent({
      ...(LogoStrip as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.Testimonial': definePageBuilderComponent({
      ...(Testimonial as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.Stats': definePageBuilderComponent({
      ...(Stats as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['columns', 'margin', 'padding', 'border'],
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
    'cms.ContactFormEmbed': definePageBuilderComponent({
      ...(ContactFormEmbed as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.Video': definePageBuilderComponent({
      ...(Video as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['maxWidth', 'align', 'margin', 'padding', 'border'],
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
      responsiveFields: ['columns', 'gap', 'view', 'margin', 'padding', 'border'],
    }),
    'catalog.ProductSlider': definePageBuilderComponent({
      ...(ProductSlider as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['slidesPerView', 'gap', 'margin', 'padding', 'border'],
    }),
    'catalog.CategoryList': definePageBuilderComponent({
      ...(CategoryList as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'catalog.CategoryGrid': definePageBuilderComponent({
      ...(CategoryGrid as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['columns', 'gap', 'margin', 'padding', 'border'],
    }),
    'cms.ContentSlider': definePageBuilderComponent({
      ...(ContentSlider as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['slidesPerView', 'gap', 'margin', 'padding', 'border'],
    }),
    'cms.Slide': definePageBuilderComponent({
      ...(Slide as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.ImageSlider': definePageBuilderComponent({
      ...(ImageSlider as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['slidesPerView', 'gap', 'margin', 'padding', 'border'],
    }),
    'cms.Tabs': definePageBuilderComponent({
      ...(Tabs as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    'cms.Accordion': definePageBuilderComponent({
      ...(Accordion as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
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
 * component that is registered in the SPI descriptor but whose React
 * renderer is missing from this bundle. Used by the admin's editor merge
 * step (T089) and by any storefront renderer that wants the same fallback.
 */
export function makeMissingComponentConfig(
  componentName: string,
  ownerModule: string,
): ComponentConfig {
  return {
    label: `${componentName} (missing renderer)`,
    fields: MissingComponentPlaceholder.fields,
    defaultProps: { componentName, ownerModule },
    render: (props) =>
      MissingComponentPlaceholder.render({
        componentName,
        ownerModule,
        ...(props as Record<string, unknown>),
      } as never),
  } as ComponentConfig;
}
