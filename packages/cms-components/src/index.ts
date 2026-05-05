// @b2b/cms-components — shared Page Builder components for the CMS module
// (feature 014).
//
// This is the canonical home for the React components that Puck composes
// in the admin editor and that the storefront renders via <Render>. The
// content of this file fills in across Phase 2 (foundational components)
// and grows over time as backend modules contribute their own components
// through the SPI defined in
// backend/src/modules/cms/services/page-builder-registry.ts.

import type { Config } from '@measured/puck';
import { Button } from './components/Button.js';
import { Columns } from './components/Columns.js';
import { Heading } from './components/Heading.js';
import { InsertBlock } from './components/InsertBlock.js';
import { InsertTemplate } from './components/InsertTemplate.js';
import { Row } from './components/Row.js';
import { Text } from './components/Text.js';

export * from './components/Button.js';
export * from './components/Columns.js';
export * from './components/Heading.js';
export * from './components/InsertBlock.js';
export * from './components/InsertTemplate.js';
export * from './components/Row.js';
export * from './components/Text.js';
export * from './components/render-context.js';
export * from './schema/component-types.js';
export * from './schema/envelope.js';

export const defaultPageBuilderConfig: Config = {
  categories: {
    layout: {
      title: 'Layout',
      components: ['Row', 'Columns'],
      defaultExpanded: true,
    },
    content: {
      title: 'Content',
      components: ['Heading', 'Text', 'Button'],
      defaultExpanded: true,
    },
    embeds: {
      title: 'Embeds',
      components: ['InsertBlock', 'InsertTemplate'],
    },
  },
  components: {
    Row,
    Columns,
    Text,
    Heading,
    Button,
    InsertBlock,
    InsertTemplate,
  },
};
