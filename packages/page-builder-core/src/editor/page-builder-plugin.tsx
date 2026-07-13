'use client';

import type { ReactElement, ReactNode } from 'react';
import type { Plugin } from '@measured/puck';
import { FieldsTabPanel } from './fields-tab-panel.js';
import { PageBuilderComponentOverlay } from './page-builder-component-overlay.js';
import { PageBuilderOutline } from './page-builder-outline.js';
import { renderResponsiveNumberField, renderResponsiveSelectField } from '../fields/responsive-field-types.js';

/** Stable references — recreating these remounts Puck fields and drops input focus. */
const STABLE_FIELD_TYPES = {
  number: (props: Parameters<typeof renderResponsiveNumberField>[0]) => renderResponsiveNumberField(props),
  select: (props: Parameters<typeof renderResponsiveSelectField>[0]) => renderResponsiveSelectField(props),
} as NonNullable<NonNullable<Plugin['overrides']>['fieldTypes']>;

const STABLE_FIELDS_OVERRIDE = ({
  children,
  isLoading,
}: {
  children: ReactNode;
  isLoading: boolean;
  itemSelector?: unknown;
}): ReactElement => <FieldsTabPanel isLoading={isLoading}>{children}</FieldsTabPanel>;

const STABLE_OUTLINE_OVERRIDE = ({ children }: { children: ReactNode }): ReactElement => (
  <PageBuilderOutline>{children}</PageBuilderOutline>
);

const STABLE_COMPONENT_OVERLAY_OVERRIDE = (props: {
  children: ReactNode;
  hover: boolean;
  isSelected: boolean;
  componentId: string;
  componentType: string;
}): ReactElement => <PageBuilderComponentOverlay {...props} />;

/**
 * Puck plugin: tabbed fields panel, responsive field types, viewport-aware preview, outline labels.
 */
export function createPageBuilderEditorPlugin(): Plugin {
  return {
    overrides: {
      fields: STABLE_FIELDS_OVERRIDE,
      outline: STABLE_OUTLINE_OVERRIDE,
      componentOverlay: STABLE_COMPONENT_OVERLAY_OVERRIDE,
      fieldTypes: STABLE_FIELD_TYPES,
    },
  };
}
