'use client';

import { type ComponentConfig, type PuckComponent, type SlotComponent } from '@measured/puck';
import type { CSSProperties, ReactElement } from 'react';
import {
  buildResponsiveNumberVars,
  contentPositionToJustify,
  normalizeResponsive,
  PB_RESPONSIVE_METADATA,
  resolveContentPosition,
  resolveResponsive,
  resolveResponsiveNumber,
  resolveVerticalAlign,
  ROW_CONTENT_MAX_WIDTH,
  verticalAlignToCss,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { RowContentMaxWidth, RowProps, RowSectionLayout } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import { createDefaultColumnItem } from './Column.js';
import {
  BACKGROUND_FIELD,
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
  RESPONSIVE_GAP_FIELD,
  RESPONSIVE_MIN_HEIGHT_FIELD,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';

const RESPONSIVE_ROW_GAP_FIELD = {
  type: 'number' as const,
  label: 'Space between rows',
  min: 0,
  max: 96,
  step: 4,
  metadata: PB_RESPONSIVE_METADATA,
};

function resolveSectionLayout(
  props: Pick<RowProps, 'sectionLayout' | 'fullBleed'>,
  tier: ReturnType<typeof usePreviewBreakpointTier>,
): RowSectionLayout {
  if (props.sectionLayout !== undefined) {
    return resolveResponsive(props.sectionLayout, tier, 'in_flow');
  }
  return props.fullBleed ? 'full_bleed' : 'in_flow';
}

function resolveContentMaxWidth(
  props: Pick<RowProps, 'contentMaxWidth' | 'contentWidth'>,
  tier: ReturnType<typeof usePreviewBreakpointTier>,
): RowContentMaxWidth {
  if (props.contentMaxWidth !== undefined) {
    return resolveResponsive(props.contentMaxWidth, tier, 'none');
  }
  const legacy = resolveResponsive(props.contentWidth, tier, 'full');
  if (legacy === 'narrow') return 'narrow';
  if (legacy === 'wide') return 'wide';
  return 'none';
}

function sectionLayoutClass(layout: RowSectionLayout): string {
  if (layout === 'full_bleed') return 'cmsc-pb-full-bleed';
  if (layout === 'full_width') return 'cmsc-pb-row-full-width';
  return '';
}

function innerMaxWidthStyle(
  maxWidth: RowContentMaxWidth,
  customMaxWidthPx: RowProps['customMaxWidthPx'],
  tier: ReturnType<typeof usePreviewBreakpointTier>,
): CSSProperties {
  if (maxWidth === 'narrow') return { maxWidth: ROW_CONTENT_MAX_WIDTH.narrow };
  if (maxWidth === 'wide') return { maxWidth: ROW_CONTENT_MAX_WIDTH.wide };
  if (maxWidth === 'custom') {
    const px = resolveResponsiveNumber(customMaxWidthPx, tier, 1200);
    return { maxWidth: `${px}px` };
  }
  return {};
}

function isPuckItem(value: unknown): value is { type: string; props: Record<string, unknown> } {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string');
}

function slotContentItems(value: unknown): Array<{ type: string; props: Record<string, unknown> }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isPuckItem);
}

function RowColumnsSlot({
  content: Content,
  gap,
  rowGap,
  verticalAlign,
  columnDivider,
  reverseOnMobile,
  tier,
  editing,
}: {
  content: SlotComponent;
  gap: RowProps['gap'];
  rowGap: RowProps['rowGap'];
  verticalAlign: RowProps['verticalAlign'];
  columnDivider?: boolean | undefined;
  reverseOnMobile?: boolean | undefined;
  tier: ReturnType<typeof usePreviewBreakpointTier>;
  editing: boolean;
}): ReactElement {
  const resolvedGap = resolveResponsiveNumber(gap, tier, 24);
  const resolvedRowGap = resolveResponsiveNumber(rowGap, tier, 24);
  const align = verticalAlignToCss(resolveVerticalAlign(verticalAlign, tier));
  const verticalAlignResponsive = normalizeResponsive(verticalAlign, 'stretch');

  return (
    <div
      className={`cmsc-pb-row-cols cmsc:grid cmsc:w-full ${columnDivider ? 'cmsc-pb-col-divider' : ''} ${reverseOnMobile ? 'cmsc-pb-cols-reverse-mobile' : ''} ${editing ? '' : 'cmsc-pb-gap cmsc-pb-row-gap cmsc-pb-cols-align'}`}
      style={
        editing
          ? {
              gap: `${resolvedGap}px`,
              rowGap: `${resolvedRowGap}px`,
              alignItems: align,
            }
          : {
              ...buildResponsiveNumberVars('gap', gap, 24),
              ...buildResponsiveNumberVars('row-gap', rowGap, 24),
            }
      }
      {...(editing
        ? {}
        : {
            'data-align': verticalAlignResponsive.base,
            'data-align-md': verticalAlignResponsive.tablet ?? verticalAlignResponsive.base,
            'data-align-lg':
              verticalAlignResponsive.desktop ??
              verticalAlignResponsive.tablet ??
              verticalAlignResponsive.base,
          })}
    >
      {editing ? <Content minEmptyHeight={96} /> : <Content />}
    </div>
  );
}

const RowEditingRender: PuckComponent<RowProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const {
    content: Content,
    gap,
    rowGap,
    contentPosition,
    minHeight,
    overflow,
    customMaxWidthPx,
    verticalAlign,
    columnDivider,
    reverseOnMobile,
    ...box
  } = props;
  const position = resolveContentPosition(contentPosition, tier);
  const sectionLayout = resolveSectionLayout(props, tier);
  const maxWidth = resolveContentMaxWidth(props, tier);

  return (
    <BoxStyled previewTier={tier} {...box}>
      <section
        className={`cmsc:flex cmsc:flex-col cmsc:w-full ${sectionLayoutClass(sectionLayout)} ${overflow ? 'cmsc:overflow-hidden' : ''}`}
        style={{
          justifyContent: contentPositionToJustify(position),
          minHeight: `${resolveResponsiveNumber(minHeight, tier, 0)}px`,
        }}
      >
        <div
          className="cmsc:flex cmsc:flex-col cmsc:w-full cmsc:mx-auto"
          style={{
            width: '100%',
            marginLeft: 'auto',
            marginRight: 'auto',
            ...innerMaxWidthStyle(maxWidth, customMaxWidthPx, tier),
          }}
        >
          <RowColumnsSlot
            content={Content}
            gap={gap}
            rowGap={rowGap}
            verticalAlign={verticalAlign}
            columnDivider={columnDivider}
            reverseOnMobile={reverseOnMobile}
            tier={tier}
            editing
          />
        </div>
      </section>
    </BoxStyled>
  );
};

const RowPublishedRender: PuckComponent<RowProps> = (props) => {
  const {
    content: Content,
    gap,
    rowGap,
    contentPosition,
    minHeight,
    overflow,
    customMaxWidthPx,
    verticalAlign,
    columnDivider,
    reverseOnMobile,
    ...box
  } = props;
  const position = normalizeResponsive(contentPosition, 'top');
  const sectionLayout = normalizeResponsive(
    props.sectionLayout ?? (props.fullBleed ? 'full_bleed' : 'in_flow'),
    'in_flow',
  );
  const maxWidth = normalizeResponsive(
    props.contentMaxWidth ??
      (props.contentWidth === 'narrow'
        ? 'narrow'
        : props.contentWidth === 'wide'
          ? 'wide'
          : 'none'),
    'none',
  );
  const minHeightMobile = resolveResponsiveNumber(minHeight, 'mobile', 0);
  const minHeightTablet = resolveResponsiveNumber(minHeight, 'tablet', 0);
  const minHeightDesktop = resolveResponsiveNumber(minHeight, 'desktop', 0);
  const needsFlexGrow = minHeightMobile > 0 || minHeightTablet > 0 || minHeightDesktop > 0;

  return (
    <BoxStyled {...box}>
      <section
        className={`cmsc:flex cmsc:flex-col cmsc:w-full cmsc-pb-min-height cmsc-pb-row-position ${sectionLayout.base === 'full_bleed' ? 'cmsc-pb-full-bleed' : ''} ${sectionLayout.base === 'full_width' || sectionLayout.tablet === 'full_width' || sectionLayout.desktop === 'full_width' ? 'cmsc-pb-row-full-width' : ''} ${overflow ? 'cmsc:overflow-hidden' : ''}`}
        style={buildResponsiveNumberVars('min-height', minHeight, 0)}
        data-position={position.base}
        data-position-md={position.tablet ?? position.base}
        data-position-lg={position.desktop ?? position.tablet ?? position.base}
      >
        <div
          className={`cmsc:flex cmsc:flex-col cmsc:w-full cmsc-pb-row-inner ${needsFlexGrow ? 'cmsc:flex-1' : ''}`}
          data-max-width={maxWidth.base}
          data-max-width-md={maxWidth.tablet ?? maxWidth.base}
          data-max-width-lg={maxWidth.desktop ?? maxWidth.tablet ?? maxWidth.base}
          style={
            maxWidth.base === 'custom' ||
            maxWidth.tablet === 'custom' ||
            maxWidth.desktop === 'custom'
              ? buildResponsiveNumberVars('row-max-width', customMaxWidthPx, 1200)
              : undefined
          }
        >
          <RowColumnsSlot
            content={Content}
            gap={gap}
            rowGap={rowGap}
            verticalAlign={verticalAlign}
            columnDivider={columnDivider}
            reverseOnMobile={reverseOnMobile}
            tier="mobile"
            editing={false}
          />
        </div>
      </section>
    </BoxStyled>
  );
};

const ROW_FIELDS = {
  content: {
    type: 'slot' as const,
    allow: ['Column'],
  },
  sectionLayout: {
    type: 'select' as const,
    label: 'Row width',
    options: [
      { label: 'In page container', value: 'in_flow' },
      { label: 'Full width', value: 'full_width' },
      { label: 'Full bleed (edge to edge)', value: 'full_bleed' },
    ],
  },
  contentMaxWidth: {
    type: 'select' as const,
    label: 'Content max width',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'None (100%)', value: 'none' },
      { label: 'Narrow (720px)', value: 'narrow' },
      { label: 'Wide (960px)', value: 'wide' },
      { label: 'Custom', value: 'custom' },
    ],
  },
  customMaxWidthPx: {
    type: 'number' as const,
    label: 'Custom max width (px)',
    min: 320,
    max: 1920,
    step: 8,
    metadata: PB_RESPONSIVE_METADATA,
  },
  contentPosition: {
    type: 'select' as const,
    label: 'Vertical position',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Top', value: 'top' },
      { label: 'Middle', value: 'middle' },
      { label: 'Bottom', value: 'bottom' },
    ],
  },
  minHeight: RESPONSIVE_MIN_HEIGHT_FIELD,
  gap: { ...RESPONSIVE_GAP_FIELD, label: 'Space between columns' },
  rowGap: RESPONSIVE_ROW_GAP_FIELD,
  verticalAlign: {
    type: 'select' as const,
    label: 'Align columns',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Top', value: 'top' },
      { label: 'Middle', value: 'middle' },
      { label: 'Bottom', value: 'bottom' },
      { label: 'Stretch', value: 'stretch' },
    ],
  },
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
  background: BACKGROUND_FIELD,
  cornerRadius: CORNER_RADIUS_FIELD,
  shadow: SHADOW_FIELD,
  columnDivider: {
    type: 'radio' as const,
    label: 'Divider between columns',
    options: [
      { label: 'No', value: false },
      { label: 'Yes', value: true },
    ],
  },
  reverseOnMobile: {
    type: 'radio' as const,
    label: 'Reverse column order on mobile',
    options: [
      { label: 'No', value: false },
      { label: 'Yes', value: true },
    ],
  },
  overflow: {
    type: 'select' as const,
    label: 'Clip content',
    options: [
      { label: 'No', value: false },
      { label: 'Yes', value: true },
    ],
  },
};

function migrateRowContent(props: RowProps): RowProps['content'] {
  const existing = slotContentItems(props.content);

  if (existing.length > 0) {
    if (existing.every((item) => item.type === 'Column')) {
      return props.content;
    }
    return [
      {
        type: 'Column' as const,
        props: {
          id: `col-legacy-${crypto.randomUUID()}`,
          span: 12,
          content: existing,
          ...DEFAULT_BOX_PROPS,
        },
      },
    ] as RowProps['content'];
  }

  const legacyItems = props.columnItems ?? [];
  if (legacyItems.length > 0) {
    return legacyItems.map((item, index) => ({
      type: 'Column' as const,
      props: {
        id: `col-migrated-${index}`,
        span: item.span ?? 12,
        content: item.content ?? [],
        ...DEFAULT_BOX_PROPS,
      },
    })) as RowProps['content'];
  }

  return [createDefaultColumnItem(`col-${crypto.randomUUID()}`)] as RowProps['content'];
}

const rowConfig: ComponentConfig<{ props: RowProps }> = {
  label: 'Row',
  fields: ROW_FIELDS,
  defaultProps: {
    content: [],
    sectionLayout: 'in_flow',
    contentMaxWidth: 'none',
    customMaxWidthPx: 1200,
    contentPosition: 'top',
    minHeight: 0,
    gap: 24,
    rowGap: 24,
    verticalAlign: 'stretch',
    columnDivider: false,
    reverseOnMobile: false,
    overflow: false,
    ...DEFAULT_BOX_PROPS,
  },
  resolveFields: (data) => {
    const maxWidth = data.props.contentMaxWidth;
    const isCustom =
      maxWidth === 'custom' ||
      (typeof maxWidth === 'object' &&
        (maxWidth.base === 'custom' || maxWidth.tablet === 'custom' || maxWidth.desktop === 'custom'));
    if (isCustom) return ROW_FIELDS;
    const { customMaxWidthPx: _removed, ...rest } = ROW_FIELDS;
    return rest;
  },
  resolveData: async ({ props }) => {
    let next: RowProps = { ...props };
    const migratedContent = migrateRowContent(next);
    next = { ...next, content: migratedContent };

    if (next.sectionLayout === undefined) {
      next = { ...next, sectionLayout: next.fullBleed ? 'full_bleed' : 'in_flow' };
    }
    if (next.contentMaxWidth === undefined && next.contentWidth !== undefined) {
      const width = normalizeResponsive(next.contentWidth, 'full').base;
      next = {
        ...next,
        contentMaxWidth: width === 'narrow' ? 'narrow' : width === 'wide' ? 'wide' : 'none',
      };
    }
    return { props: next };
  },
  render: (props) =>
    props.puck?.isEditing ? <RowEditingRender {...props} /> : <RowPublishedRender {...props} />,
};

export const Row = withHideOn(rowConfig);
