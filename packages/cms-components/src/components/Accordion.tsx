'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import {
  createColorField,
  PB_RESPONSIVE_METADATA,
  isResponsiveProp,
  resolveResponsive,
  withHideOn,
  type BreakpointTier,
  createToggleField,
} from '@endora-commerce/page-builder-core';
import type { AccordionDividers, AccordionIconSize, AccordionProps } from '../schema/component-types.js';
import { colorValueToCss } from '../utils/color-value.js';
import { gapField, gapPxField, sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';
import { gapCss, gapVars, isDefaultSize, sizedTextProps, usesCustom, type TextSize } from './section-parts.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { PanelBody, panelItemsFromLegacy, panelSlotField } from './panel-slot.js';
import { createItemIndexField, itemIndexFieldFor } from '../fields/item-index-field.js';
import { useBlockDomId } from './block-dom-id.js';
import { TYPE_SCALE_FALLBACKS, isTypeToken, textWeightCss, textWeightField } from './typography.js';
import { customOnlyLeading, lineHeightField, sizeUsesCustom } from './text-style.js';
import { lineHeightCss } from './tier-vars.js';

/**
 * `cms.Accordion` (`specs/163-page-builder-marketing-pages/` research R-13,
 * FR-023): each item's panel holds blocks. Every option of `origin/master` is
 * kept (plan § Extend, don't narrow).
 *
 * Collapsed panels are rendered on the server with `hidden`, so their content
 * is in the HTML (US5 acceptance 2). `<details>` was rejected (R-13): it cannot
 * keep one item open at a time.
 *
 * T175 (R11): the look — `icon` (today's plus/minus, or a chevron that turns),
 * `dividers` between plain items, `itemStyle` (plain, boxed or filled; unset follows
 * `variant`, whose `bordered` is boxed) and the title's `titlePadding` per
 * breakpoint. Unset, each writes nothing. Once mounted the root carries
 * `data-animate`, and the stylesheet animates a panel's open and close —
 * never on the server, so a panel open by default does not animate in on page
 * load, never under reduced motion, and instantly where the browser cannot.
 *
 * T179 (R12): the triggers' `titleColor` (the icon, drawn in `currentColor`,
 * follows it), the line of an item drawn under its title instead of under the
 * item (`dividerPosition`), and the icon's size (`iconSize`, a token or a
 * Custom px). Unset, each writes nothing.
 *
 * T182 (R13): the space between a title (its line) and its open panel
 * (`panelGap`) and between items (`itemGap`), each a spacing token or a Custom
 * px per breakpoint (Responsive tab). Once set, a tier left unset reads
 * today's spacing: no space above a panel (12 px under a title line), none
 * between plain items, 8 px between boxed ones. T183: the titles' weight
 * (`titleWeight`, the shared text-weight field). Unset, each writes nothing.
 *
 * T185 (R14): the title weight per breakpoint (Responsive tab). One weight —
 * plain, stored with only its base, or the same at every tier — stays T183's
 * inline `font-weight`; weights that differ go on the root per tier. T186: the
 * open panel's bottom space (`panelPaddingBottom`, today's 12 px) and the gap
 * after an open item (`openItemGap`, instead of the item gap while the item is
 * open), each a token or Custom px per breakpoint. Unset, each writes nothing.
 */

const TITLE_LEVELS = ['h2', 'h3', 'h4', 'h5', 'h6'] as const;
type TitleLevel = (typeof TITLE_LEVELS)[number];

function titleLevelOf(level: unknown): TitleLevel | null {
  return typeof level === 'string' && (TITLE_LEVELS as readonly string[]).includes(level) ? (level as TitleLevel) : null;
}

/**
 * The title's classes and style (T134): today's 15 px semibold while its size
 * is unset or `default`; otherwise the type token's class, or a Custom px.
 * A tier left on `default` among chosen ones reads the `body` token.
 */
function titleSizing(props: AccordionProps, tier: BreakpointTier | null): { className: string; style?: CSSProperties } {
  if (isDefaultSize(props.titleSize)) return { className: 'cmsc-pb-accordion__title' };
  const sized = sizedTextProps(props.titleSize as TextSize, props.titleSizePx, 'body', tier);
  return {
    className: ['cmsc-pb-accordion__title', 'cmsc-pb-accordion__title--sized', ...sized.classes].join(' '),
    ...(Object.keys(sized.style).length > 0 ? { style: sized.style as CSSProperties } : {}),
  };
}

const DIVIDERS: readonly AccordionDividers[] = ['none', 'between', 'all'];

/** Whether the items are boxed: `itemStyle`, else today's `bordered` style. */
function isBoxed(props: Pick<AccordionProps, 'itemStyle' | 'variant'>): boolean {
  if (props.itemStyle === 'boxed') return true;
  if (props.itemStyle === 'plain') return false;
  return props.variant === 'bordered';
}

/** Feature 169 (US3): items that carry no divider of their own — boxed, or filled title bars. */
function hasNoDividers(props: Pick<AccordionProps, 'itemStyle' | 'variant'>): boolean {
  return isBoxed(props) || props.itemStyle === 'filled';
}

/** The look classes T175 adds to the root (none when unset). */
function lookClasses(props: AccordionProps): string[] {
  const classes: string[] = [];
  if (isChevron(props.icon)) classes.push('cmsc-pb-accordion--chevron');
  if (props.itemStyle === 'boxed' || props.itemStyle === 'plain' || props.itemStyle === 'filled') classes.push(`cmsc-pb-accordion--${props.itemStyle}`);
  if (!hasNoDividers(props) && DIVIDERS.includes(props.dividers as AccordionDividers)) classes.push(`cmsc-pb-accordion--dividers-${props.dividers}`);
  return classes;
}

/**
 * The chevron icon. R23 (T441): R20F's `'chevron-circle'` (a chevron on a
 * filled circle, removed) reads as the plain chevron.
 */
function isChevron(icon: unknown): boolean {
  return icon === 'chevron' || icon === 'chevron-circle';
}

/** Whether the items carry a line of their own (the one `dividerPosition` may move under the title). */
function hasItemLines(props: AccordionProps): boolean {
  if (hasNoDividers(props)) return false;
  if (DIVIDERS.includes(props.dividers as AccordionDividers)) return props.dividers !== 'none';
  return props.itemStyle === 'plain' || props.variant !== 'flush';
}

const ICON_SIZE_PX: Record<Exclude<AccordionIconSize, 'custom'>, number> = { s: 16, m: 20, l: 24 };

/** T179: the icon's size in px, or `null` while unset (today's: the trigger's text size). */
function iconSizePx(props: Pick<AccordionProps, 'iconSize' | 'iconSizePx'>): number | null {
  if (props.iconSize === 'custom') {
    const px = props.iconSizePx;
    return typeof px === 'number' && Number.isFinite(px) && px > 0 ? px : null;
  }
  return typeof props.iconSize === 'string' && props.iconSize in ICON_SIZE_PX ? ICON_SIZE_PX[props.iconSize as keyof typeof ICON_SIZE_PX] : null;
}

/** T179: the classes and variables of the title colour, the divider position and the icon size (none when unset). */
function r12Look(props: AccordionProps): { classes: string[]; vars: Record<string, string> } {
  const classes: string[] = [];
  const vars: Record<string, string> = {};
  const color = colorValueToCss(props.titleColor);
  if (color) {
    classes.push('cmsc-pb-accordion--title-color');
    vars['--cmsc-acc-title'] = color;
  }
  if (props.dividerPosition === 'title' && hasItemLines(props)) classes.push('cmsc-pb-accordion--divider-title');
  const icon = iconSizePx(props);
  if (icon !== null) {
    classes.push('cmsc-pb-accordion--icon-size');
    vars['--cmsc-acc-icon'] = `${icon}px`;
  }
  return { classes, vars };
}

/** T182: whether a gap is chosen (any tier, a value or a Custom px). */
function hasGap(gap: unknown): boolean {
  return gap !== undefined && gap !== null && gap !== '';
}

const TIERS: readonly BreakpointTier[] = ['mobile', 'tablet', 'desktop'];
const TIER_SUFFIX: Record<BreakpointTier, string> = { mobile: '', tablet: '-md', desktop: '-lg' };

/** T185: the chosen weight at each tier (`undefined` where none is: unset, Default or unknown). */
function weightsPerTier(value: unknown): Record<BreakpointTier, number | undefined> {
  const at = (tier: BreakpointTier) => textWeightCss(isResponsiveProp(value) ? resolveResponsive<unknown>(value, tier, undefined) : value);
  return { mobile: at('mobile'), tablet: at('tablet'), desktop: at('desktop') };
}

/**
 * T185: the titles' weight. `inline` — one weight for every width, T183's
 * inline `font-weight` (in the editor, the previewed tier's) — or `vars`, a
 * weight per tier on the root, `today` where a tier has none of its own.
 */
function titleWeightOf(
  value: unknown,
  tier: BreakpointTier | null,
  today: string,
): { inline?: number; vars?: Record<string, string> } {
  const weights = weightsPerTier(value);
  if (tier !== null) return weights[tier] !== undefined ? { inline: weights[tier] } : {};
  const chosen = TIERS.map((at) => weights[at]);
  if (chosen.every((weight) => weight === undefined)) return {};
  if (chosen.every((weight) => weight === chosen[0])) return { inline: chosen[0]! };
  const vars: Record<string, string> = {};
  for (const at of TIERS) vars[`--cmsc-acc-title-weight${TIER_SUFFIX[at]}`] = weights[at] !== undefined ? String(weights[at]) : today;
  return { vars };
}

/**
 * R21G (T338): the titles' line height, as their weight (T185): one for every
 * width inline on each title (in the editor, the previewed tier's), or one per
 * tier on the root, `today` where a tier has none of its own.
 */
function titleLeadingOf(value: unknown, tier: BreakpointTier | null, today: string): { inline?: string; vars?: Record<string, string> } {
  const at = (t: BreakpointTier): string | undefined => lineHeightCss(resolveResponsive<number>(value as never, t, Number.NaN));
  if (tier !== null) {
    const own = at(tier);
    return own !== undefined ? { inline: own } : {};
  }
  const chosen = TIERS.map(at);
  if (chosen.every((leading) => leading === undefined)) return {};
  if (chosen.every((leading) => leading === chosen[0])) return { inline: chosen[0]! };
  const vars: Record<string, string> = {};
  TIERS.forEach((t, index) => {
    vars[`--cmsc-acc-title-lh${TIER_SUFFIX[t]}`] = chosen[index] ?? today;
  });
  return { vars };
}

/** R21G (T338): a title's own line height today: inherited from the trigger, or its size token's. */
function todaysTitleLeading(titleClass: string): string {
  const token = /(?:^| )cmsc-t--([a-z0-9]+)/.exec(titleClass)?.[1];
  return isTypeToken(token) ? `var(--cmsb-t-${token}-lh, ${TYPE_SCALE_FALLBACKS[token].lineHeight})` : 'inherit';
}

/** T185: a title's own weight today: the trigger's semibold, or its size token's weight. */
function todaysTitleWeight(titleClass: string): string {
  const token = /(?:^| )cmsc-t--([a-z0-9]+)/.exec(titleClass)?.[1];
  return isTypeToken(token) ? `var(--cmsb-t-${token}-w, ${TYPE_SCALE_FALLBACKS[token].weight})` : '600';
}

/**
 * T186: the gap after an open item per tier — its own value where it has one,
 * else the item gap there (`itemGapCss`), so a tier left unset looks as today.
 */
function openGapVars(
  props: Pick<AccordionProps, 'openItemGap' | 'openItemGapPx'>,
  itemGapCss: (tier: BreakpointTier) => string,
  fallbackPx: number,
  tier: BreakpointTier | null,
): Record<string, string> {
  const at = (t: BreakpointTier): string => {
    const own = isResponsiveProp(props.openItemGap) ? resolveResponsive<unknown>(props.openItemGap, t, undefined) : props.openItemGap;
    return own === undefined || own === null || own === '' ? itemGapCss(t) : gapCss(props.openItemGap as AccordionProps['openItemGap'], props.openItemGapPx, fallbackPx, t);
  };
  if (tier !== null) return { '--cmsc-acc-open-gap': at(tier) };
  const vars: Record<string, string> = {};
  for (const t of TIERS) vars[`--cmsc-acc-open-gap${TIER_SUFFIX[t]}`] = at(t);
  return vars;
}

/** An accordion stored before the reshape, with each HTML panel moved into its slot. */
export function accordionFromLegacy(props: Record<string, unknown>): AccordionProps & Record<string, unknown> {
  return panelItemsFromLegacy(props) as unknown as AccordionProps & Record<string, unknown>;
}

/** The items open at first: the field writes one index, a stored page may hold a list. */
function initiallyOpen(defaultOpen: AccordionProps['defaultOpen'], allowMultiple: boolean): Set<number> {
  const list = (Array.isArray(defaultOpen) ? defaultOpen : [defaultOpen]).filter(
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  );
  return new Set(allowMultiple ? list : list.slice(0, 1));
}

const AccordionRender: PuckComponent<AccordionProps> = (props) => {
  const {
    items = [],
    allowMultiple = false,
    defaultOpen = [],
    iconPosition = 'end',
    variant = 'default',
    titleLevel: _titleLevel,
    titleSize: _titleSize,
    titleSizePx: _titleSizePx,
    icon: _icon,
    dividers: _dividers,
    itemStyle: _itemStyle,
    titlePadding,
    titlePaddingPx,
    titleColor: _titleColor,
    dividerPosition: _dividerPosition,
    iconSize: _iconSize,
    iconSizePx: _iconSizePx,
    panelGap,
    panelGapPx,
    itemGap,
    itemGapPx,
    titleWeight: _titleWeight,
    titleLineHeight: _titleLineHeight,
    panelPaddingBottom,
    panelPaddingBottomPx,
    openItemGap: _openItemGap,
    openItemGapPx: _openItemGapPx,
    puck,
    ...box
  } = props;
  const editing = puck?.isEditing === true;
  const tier = editing ? 'desktop' : null;
  const chevron = isChevron(props.icon);
  // T175: the title padding per breakpoint (the editor previews the desktop tier, as the title size).
  const padded = titlePadding !== undefined && titlePadding !== null;
  const padVars = padded
    ? gapVars('cmsc-acc-pad', titlePadding as AccordionProps['titlePadding'], titlePaddingPx, 12, tier)
    : null;
  const r12 = r12Look(props as unknown as AccordionProps);
  // T182: the space above an open panel and between items per breakpoint; a tier left unset reads today's.
  const panelGapped = hasGap(panelGap);
  const panelGapVars = panelGapped
    ? gapVars('cmsc-acc-panel-gap', panelGap as AccordionProps['panelGap'], panelGapPx, r12.classes.includes('cmsc-pb-accordion--divider-title') || props.itemStyle === 'filled' ? 12 : 0, tier)
    : null;
  const itemGapped = hasGap(itemGap);
  const todaysItemGapPx = hasNoDividers(props as unknown as AccordionProps) ? 8 : 0;
  const itemGapVars = itemGapped
    ? gapVars('cmsc-acc-item-gap', itemGap as AccordionProps['itemGap'], itemGapPx, todaysItemGapPx, tier)
    : null;
  // T186: the open panel's bottom space (today's 12 px where a tier is unset) and the gap after an open item.
  const panelBottomed = hasGap(panelPaddingBottom);
  const panelBottomVars = panelBottomed
    ? gapVars('cmsc-acc-panel-bottom', panelPaddingBottom as AccordionProps['panelPaddingBottom'], panelPaddingBottomPx, 12, tier)
    : null;
  const openGapped = hasGap(props.openItemGap);
  const openGap = openGapped
    ? openGapVars(
        props as unknown as AccordionProps,
        (t) => (itemGapped ? gapCss(itemGap as AccordionProps['itemGap'], itemGapPx, todaysItemGapPx, t) : `${todaysItemGapPx}px`),
        todaysItemGapPx,
        tier,
      )
    : null;
  // The titles' classes, and T183/T185's weight: one inline, or one per breakpoint on the root.
  const title = titleSizing(props as unknown as AccordionProps, tier);
  const weight = titleWeightOf(props.titleWeight, tier, todaysTitleWeight(title.className));
  // R23 (T435): the line height only from a breakpoint sized in Custom px.
  const leading = titleLeadingOf(customOnlyLeading(props.titleSize, props.titleLineHeight), tier, todaysTitleLeading(title.className));
  const rootClass = [
    'cmsc-pb-accordion',
    `cmsc-pb-accordion--${variant}`,
    `cmsc-pb-accordion--icon-${iconPosition}`,
    ...lookClasses(props as unknown as AccordionProps),
    ...(padded ? ['cmsc-pb-accordion--title-pad'] : []),
    ...r12.classes,
    ...(panelGapped ? ['cmsc-pb-accordion--panel-gap'] : []),
    ...(itemGapped ? ['cmsc-pb-accordion--item-gap'] : []),
    ...(weight.vars ? ['cmsc-pb-accordion--title-weight'] : []),
    ...(leading.vars ? ['cmsc-pb-accordion--title-leading'] : []),
    ...(panelBottomed ? ['cmsc-pb-accordion--panel-bottom'] : []),
    ...(openGapped ? ['cmsc-pb-accordion--open-gap'] : []),
  ].join(' ');
  const rootStyle = {
    ...(padVars ?? {}),
    ...r12.vars,
    ...(panelGapVars ?? {}),
    ...(itemGapVars ?? {}),
    ...(weight.vars ?? {}),
    ...(leading.vars ?? {}),
    ...(panelBottomVars ?? {}),
    ...(openGap ?? {}),
  } as CSSProperties;
  // T175: open and close animate only once interactive (after hydration), never on the server.
  const [animate, setAnimate] = useState(false);
  useEffect(() => setAnimate(true), []);
  // The WAI-ARIA accordion pattern: with a level, each trigger button sits inside a heading.
  const Heading = titleLevelOf(props.titleLevel);
  // T183: one weight over the trigger's semibold (and a size token's own weight), inline on every title.
  const weighted = weight.inline !== undefined ? { ...(title.style ?? {}), fontWeight: weight.inline } : title.style;
  // R21G (T338): one line height, inline on every title.
  const titleStyle = leading.inline !== undefined ? { ...(weighted ?? {}), lineHeight: leading.inline } : weighted;
  // The block's id, not `useId()` alone: the same on the server and on hydration (T149).
  const baseId = useBlockDomId('pb-accordion', props.id);
  const [open, setOpen] = useState<Set<number>>(() => initiallyOpen(defaultOpen, allowMultiple));

  const toggle = (index: number): void => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        if (!allowMultiple) next.clear();
        next.add(index);
      }
      return next;
    });
  };

  if (items.length === 0) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})}>
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Add accordion items in the sidebar</p>
      </BoxStyled>
    );
  }

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})}>
      <div
        className={rootClass}
        {...(Object.keys(rootStyle).length > 0 ? { style: rootStyle } : {})}
        {...(animate ? { 'data-animate': '' } : {})}
      >
        {items.map((item, i) => {
          const expanded = open.has(i);
          const triggerId = `${baseId}-trigger-${i}`;
          const panelId = `${baseId}-panel-${i}`;
          const icon = chevron ? (
            <span className="cmsc-pb-accordion__icon cmsc-pb-accordion__icon--chevron" aria-hidden />
          ) : (
            <span className="cmsc-pb-accordion__icon" aria-hidden>
              {expanded ? '−' : '+'}
            </span>
          );
          const trigger: ReactNode = (
            <button
              type="button"
              id={triggerId}
              className="cmsc-pb-accordion__trigger"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggle(i)}
            >
              {iconPosition === 'start' ? icon : null}
              <span className={title.className} {...(titleStyle ? { style: titleStyle } : {})}>
                {item.title || `Item ${i + 1}`}
              </span>
              {iconPosition === 'end' ? icon : null}
            </button>
          );
          return (
            <div key={i} className="cmsc-pb-accordion__item">
              {Heading ? <Heading className="cmsc-pb-accordion__heading">{trigger}</Heading> : trigger}
              <div
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
                className="cmsc-pb-accordion__panel"
                hidden={!expanded}
              >
                <PanelBody item={item} />
              </div>
            </div>
          );
        })}
      </div>
    </BoxStyled>
  );
};

function richParagraph(text: string) {
  return {
    type: 'cms.RichContent',
    props: {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      html: `<p>${text}</p>`,
    },
  };
}

const ACCORDION_FIELDS = {
  items: {
    type: 'array' as const,
    label: 'Items',
    arrayFields: {
      title: { type: 'text' as const, label: 'Title' },
      panel: panelSlotField('Panel'),
    },
    defaultItemProps: { title: 'Section', panel: [] },
    getItemSummary: (item: { title?: string }, index?: number) => item.title || `Item ${(index ?? 0) + 1}`,
  },
  allowMultiple: createToggleField({ label: 'Allow multiple open' }),
  // R17 (T218): the item open at first, chosen among the items (the index it always stored).
  defaultOpen: createItemIndexField('Item open at first', { none: true }),
  iconPosition: {
    type: 'select' as const,
    label: 'Icon position',
    options: [
      { label: 'Start', value: 'start' },
      { label: 'End', value: 'end' },
    ],
  },
  variant: {
    type: 'select' as const,
    label: 'Style',
    options: [
      { label: 'Default', value: 'default' },
      { label: 'Flush', value: 'flush' },
      { label: 'Bordered', value: 'bordered' },
    ],
  },
  // T134: the titles as headings (no h1 — the page's one H1 is its title's) and their size.
  titleLevel: {
    type: 'select' as const,
    label: 'Title level',
    options: [
      { label: 'Not a heading', value: 'none' },
      ...TITLE_LEVELS.map((level) => ({ label: level.toUpperCase(), value: level })),
    ],
  },
  titleSize: sizeFieldWithDefault('Title size'),
  titleSizePx: sizePxField('Custom title size (px)'),
  // T179: the triggers' colour (the icon follows it); unset keeps today's.
  titleColor: createColorField({ label: 'Title color' }),
  // T183: the titles' weight; Default keeps today's. T185: per breakpoint (Responsive tab).
  titleWeight: { ...textWeightField('Title weight'), metadata: PB_RESPONSIVE_METADATA },
  // R21G (T338): the titles' line height per breakpoint; empty keeps today's.
  titleLineHeight: lineHeightField('Title line height'),
  // T175: the look. Each unset by default — today's plus/minus, the style's own lines and box, 12 px.
  icon: {
    type: 'select' as const,
    label: 'Icon',
    options: [
      { label: 'Plus and minus', value: 'plus' },
      { label: 'Chevron', value: 'chevron' },
    ],
  },
  // T179: the icon's size, a token or Custom px; unset keeps today's (the trigger's text size).
  iconSize: {
    type: 'select' as const,
    label: 'Icon size',
    options: [
      { label: 'Small (16 px)', value: 's' },
      { label: 'Medium (20 px)', value: 'm' },
      { label: 'Large (24 px)', value: 'l' },
      { label: 'Custom (px)', value: 'custom' },
    ],
  },
  iconSizePx: { type: 'number' as const, label: 'Custom icon size (px)', min: 8, max: 64 },
  itemStyle: {
    type: 'select' as const,
    label: 'Item style',
    options: [
      { label: 'Plain', value: 'plain' },
      { label: 'Boxed', value: 'boxed' },
      { label: 'Filled', value: 'filled' },
    ],
  },
  dividers: {
    type: 'select' as const,
    label: 'Dividers',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Between items', value: 'between' },
      { label: 'Above, between and below', value: 'all' },
    ],
  },
  // T179: an item's line under the item (today's) or under its title.
  dividerPosition: {
    type: 'select' as const,
    label: 'Divider position',
    options: [
      { label: 'Under the item', value: 'item' },
      { label: 'Under the title', value: 'title' },
    ],
  },
  titlePadding: gapField('Title padding'),
  titlePaddingPx: gapPxField('Custom title padding (px)'),
  // T182: the space between a title (its line) and its open panel, and between items, per breakpoint.
  panelGap: gapField('Space above the open panel'),
  panelGapPx: gapPxField('Custom space above the open panel (px)'),
  itemGap: gapField('Space between items'),
  itemGapPx: gapPxField('Custom space between items (px)'),
  // T186: the space below an open panel (today's 12 px) and after an open item (today's: the item gap), per breakpoint.
  panelPaddingBottom: gapField('Space below the open panel'),
  panelPaddingBottomPx: gapPxField('Custom space below the open panel (px)'),
  openItemGap: gapField('Space after an open item'),
  openItemGapPx: gapPxField('Custom space after an open item (px)'),
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const accordionConfig: ComponentConfig<AccordionProps> = {
  label: 'Accordion',
  fields: ACCORDION_FIELDS as unknown as Fields<AccordionProps>,
  defaultProps: {
    items: [{ title: 'Section 1', panel: [richParagraph('First section')] }],
    allowMultiple: false,
    defaultOpen: [],
    iconPosition: 'end',
    variant: 'default',
    ...DEFAULT_BOX_PROPS,
  } as unknown as AccordionProps,
  // The Custom px is offered once a tier of the title size (T175: of the title padding) is on Custom;
  // the dividers and their position only for plain items, the icon's Custom px once Custom is chosen.
  resolveFields: (data, params) => {
    const props = data.props as AccordionProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? ACCORDION_FIELDS)) {
      if (key === 'titleSizePx' && !usesCustom(props.titleSize)) continue;
      if (key === 'titlePaddingPx' && !usesCustom(props.titlePadding)) continue;
      if (key === 'panelGapPx' && !usesCustom(props.panelGap)) continue;
      if (key === 'itemGapPx' && !usesCustom(props.itemGap)) continue;
      if (key === 'panelPaddingBottomPx' && !usesCustom(props.panelPaddingBottom)) continue;
      if (key === 'openItemGapPx' && !usesCustom(props.openItemGap)) continue;
      if ((key === 'dividers' || key === 'dividerPosition') && hasNoDividers(props)) continue;
      // R17 (T218): the divider position only where the items carry a line it could move.
      if (key === 'dividerPosition' && !hasItemLines(props)) continue;
      if (key === 'iconSizePx' && props.iconSize !== 'custom') continue;
      // R23 (T435): a line height with a Custom px size only.
      if (key === 'titleLineHeight' && !sizeUsesCustom(props.titleSize)) continue;
      fields[key] =
        key === 'defaultOpen'
          ? itemIndexFieldFor(field, (props.items ?? []).map((item) => (typeof item?.title === 'string' ? item.title : '')))
          : field;
    }
    return fields as unknown as Fields<AccordionProps>;
  },
  // An accordion stored with HTML panels is carried into the slots when it is opened.
  resolveData: ({ props }) => ({ props: accordionFromLegacy(props as unknown as Record<string, unknown>) }),
  render: AccordionRender,
};

export const Accordion = withHideOn(accordionConfig);
