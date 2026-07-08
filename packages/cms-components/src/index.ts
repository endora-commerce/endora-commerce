// @b2b/cms-components — shared Page Builder components for the CMS module
// (feature 014).

import type { ComponentConfig, Config } from '@measured/puck';
import { definePageBuilderComponent, withHideOn } from '@b2b/page-builder-core';
import { Button } from './components/Button.js';
import { Column } from './components/Column.js';
import { Heading } from './components/Heading.js';
import { Image } from './components/Image.js';
import { InsertBlock } from './components/InsertBlock.js';
import { InsertTemplate } from './components/InsertTemplate.js';
import { MissingComponentPlaceholder } from './components/MissingComponentPlaceholder.js';
import { RichContent } from './components/RichContent.js';
import { Row } from './components/Row.js';
import { Text } from './components/Text.js';

export * from './components/Button.js';
export * from './components/Column.js';
export * from './components/Heading.js';
export * from './components/Image.js';
export * from './components/InsertBlock.js';
export * from './components/InsertTemplate.js';
export * from './components/MissingComponentPlaceholder.js';
export * from './components/RichContent.js';
export * from './components/Row.js';
export * from './components/Text.js';
export * from './components/render-context.js';
export * from './components/box-styles.js';
export * from './schema/component-types.js';
export * from './schema/envelope.js';

export const defaultPageBuilderConfig: Config = {
  categories: {
    layout: {
      title: 'Layout',
      components: ['Row'],
      defaultExpanded: true,
    },
    content: {
      title: 'Content',
      components: ['Heading', 'Text', 'RichContent', 'Button', 'Image'],
      defaultExpanded: true,
    },
    embeds: {
      title: 'Embeds',
      components: ['InsertBlock', 'InsertTemplate'],
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
      ...(withHideOn(Text as unknown as ComponentConfig) as ComponentConfig),
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
      ...(withHideOn(Image as unknown as ComponentConfig) as ComponentConfig),
      contexts: ['cms'],
      responsiveFields: ['widthMode', 'widthPx', 'align', 'margin', 'padding', 'border'],
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
