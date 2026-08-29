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

export const defaultPageBuilderConfig: Config = {
  categories: {
    layout: {
      title: 'Layout',
      components: ['Row', 'Spacer'],
      defaultExpanded: true,
    },
    content: {
      title: 'Content',
      components: [
        'Heading',
        'Text',
        'RichContent',
        'Button',
        'Image',
        'Icons',
        'Social',
        'FeatureList',
        'Hero',
        'LogoStrip',
        'Testimonial',
        'Stats',
        'AnnouncementBar',
        'SimpleTable',
      ],
      defaultExpanded: true,
    },
    media: {
      title: 'Media',
      components: ['Video', 'Map'],
    },
    catalog: {
      title: 'Catalog',
      components: ['ProductCard', 'ProductGrid', 'ProductSlider', 'CategoryList', 'CategoryGrid'],
    },
    interactive: {
      title: 'Interactive',
      components: ['ContentSlider', 'ImageSlider', 'Tabs', 'Accordion'],
    },
    /** Hidden drawer category — keeps internal slot-only components out of "Other". */
    _internal: {
      title: 'Internal',
      components: ['Column', 'Slide'],
      visible: false,
    },
    forms: {
      title: 'Forms',
      components: ['NewsletterSignup', 'ContactFormEmbed'],
    },
    advanced: {
      title: 'Advanced',
      components: ['RawHtml', 'RawJs'],
    },
    embeds: {
      title: 'Embeds',
      components: ['InsertBlock'],
    },
  },
  components: {
    Row: definePageBuilderComponent({
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
    Column: definePageBuilderComponent({
      ...(Column as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['span', 'margin', 'padding', 'border'],
    }),
    Text: definePageBuilderComponent({
      ...(Text as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['fontSize', 'fontWeight', 'textAlign', 'lineHeight', 'margin', 'padding', 'border'],
    }),
    RichContent: definePageBuilderComponent({
      ...(withHideOn(RichContent as unknown as ComponentConfig) as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    Heading: definePageBuilderComponent({
      ...(Heading as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['fontSize', 'fontWeight', 'textAlign', 'lineHeight', 'margin', 'padding', 'border'],
    }),
    Button: definePageBuilderComponent({
      ...(Button as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['variant', 'margin', 'padding', 'border'],
    }),
    Image: definePageBuilderComponent({
      ...(Image as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['widthMode', 'widthPx', 'align', 'margin', 'padding', 'border'],
    }),
    Icons: definePageBuilderComponent({
      ...(Icons as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['align', 'margin', 'padding', 'border'],
    }),
    Social: definePageBuilderComponent({
      ...(Social as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['align', 'margin', 'padding', 'border'],
    }),
    Spacer: definePageBuilderComponent({
      ...(Spacer as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['heightPx'],
    }),
    FeatureList: definePageBuilderComponent({
      ...(FeatureList as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['columns', 'gap', 'margin', 'padding', 'border'],
    }),
    Hero: definePageBuilderComponent({
      ...(Hero as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['minHeightPx', 'margin', 'padding', 'border'],
    }),
    LogoStrip: definePageBuilderComponent({
      ...(LogoStrip as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    Testimonial: definePageBuilderComponent({
      ...(Testimonial as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    Stats: definePageBuilderComponent({
      ...(Stats as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['columns', 'margin', 'padding', 'border'],
    }),
    AnnouncementBar: definePageBuilderComponent({
      ...(AnnouncementBar as unknown as ComponentConfig),
      contexts: ['cms'],
    }),
    SimpleTable: definePageBuilderComponent({
      ...(SimpleTable as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    NewsletterSignup: definePageBuilderComponent({
      ...(NewsletterSignup as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    ContactFormEmbed: definePageBuilderComponent({
      ...(ContactFormEmbed as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    Video: definePageBuilderComponent({
      ...(Video as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['maxWidth', 'align', 'margin', 'padding', 'border'],
    }),
    Map: definePageBuilderComponent({
      ...(Map as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['height', 'margin', 'padding', 'border'],
    }),
    ProductCard: definePageBuilderComponent({
      ...(ProductCard as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['maxWidthPx', 'imageHeightPx', 'margin', 'padding', 'border'],
    }),
    ProductGrid: definePageBuilderComponent({
      ...(ProductGrid as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['columns', 'gap', 'view', 'margin', 'padding', 'border'],
    }),
    ProductSlider: definePageBuilderComponent({
      ...(ProductSlider as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['slidesPerView', 'gap', 'margin', 'padding', 'border'],
    }),
    CategoryList: definePageBuilderComponent({
      ...(CategoryList as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    CategoryGrid: definePageBuilderComponent({
      ...(CategoryGrid as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['columns', 'gap', 'margin', 'padding', 'border'],
    }),
    ContentSlider: definePageBuilderComponent({
      ...(ContentSlider as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['slidesPerView', 'gap', 'margin', 'padding', 'border'],
    }),
    Slide: definePageBuilderComponent({
      ...(Slide as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    ImageSlider: definePageBuilderComponent({
      ...(ImageSlider as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['slidesPerView', 'gap', 'margin', 'padding', 'border'],
    }),
    Tabs: definePageBuilderComponent({
      ...(Tabs as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    Accordion: definePageBuilderComponent({
      ...(Accordion as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    RawHtml: definePageBuilderComponent({
      ...(RawHtml as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    RawJs: definePageBuilderComponent({
      ...(RawJs as unknown as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['margin', 'padding', 'border'],
    }),
    InsertBlock: definePageBuilderComponent({
      ...(withHideOn(InsertBlock as unknown as ComponentConfig) as ComponentConfig),
      contexts: ['cms'],
    }),
    InsertTemplate: definePageBuilderComponent({
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
