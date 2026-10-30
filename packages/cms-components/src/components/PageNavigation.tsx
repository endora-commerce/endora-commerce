'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { FieldLabel, type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import {
  PB_FIELD_INPUT_CLASS,
  SECTION_ANCHOR_RE,
  createToggleField,
  normalizeAnchor,
  resolveResponsive,
  withHideOn,
  type BreakpointTier,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { BlockAlign, PageNavigationItem, PageNavigationLook, PageNavigationProps } from '../schema/component-types.js';
import { BOX_BORDER_FIELD, BOX_MARGIN_FIELD, BOX_PADDING_FIELD, DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';
import { alignField } from '../fields/section-block-fields.js';
import { BoxStyled } from './box-styles.js';
import { useCmsRenderPageNavigationText } from './render-context.js';
import { usePageNavigationSpy } from './page-navigation-spy.js';

/**
 * `cms.PageNavigation` — `specs/169-page-builder-contact-form/` US5,
 * FR-010–FR-014, contracts/blocks.md §3, data-model §2.
 *
 * A row of links to sections of the same page ("jump links"). On the server it
 * is a `<nav>` with an accessible name around a list of plain `<a href="#…">`
 * links, so it works with JavaScript off; the client island
 * (`page-navigation-spy.ts`) marks the link of the section in view with
 * `aria-current="true"`. Two looks — one rounded pill track whose active item
 * is filled, and an underline — an alignment per breakpoint and an optional
 * sticky bar below the storefront header. On a phone the list scrolls sideways
 * inside the block. Smooth scrolling and the sticky offset of a jump target are
 * the stylesheet's (`/* ── Page navigation *\/`), so a reader who prefers
 * reduced motion jumps instantly.
 *
 * An item with no label or an anchor outside the grammar is skipped, never the
 * block; with no valid item the storefront renders nothing and the editor a
 * note. In the editor an anchor no element on the canvas carries is listed in a
 * warning (it still renders: any element id is a valid target).
 */

/** Most links one bar renders (contracts/blocks.md §3). */
export const PAGE_NAVIGATION_MAX_ITEMS = 20;

const LABEL_MAX = 80;
const NAV_LABEL_MAX = 120;
const LOOKS: readonly PageNavigationLook[] = ['pill', 'underline'];
const ALIGNS: readonly BlockAlign[] = ['start', 'center', 'end'];
const DEFAULT_NAV_LABEL = 'On this page';

/** The rendered items: a trimmed label of 1–80 characters and an anchor in the grammar; at most 20. */
export function pageNavigationItems(items: unknown): Array<{ label: string; anchor: string }> {
  if (!Array.isArray(items)) return [];
  const valid: Array<{ label: string; anchor: string }> = [];
  for (const item of items as Array<PageNavigationItem | null | undefined>) {
    if (!item || typeof item !== 'object') continue;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const anchor = typeof item.anchor === 'string' ? item.anchor : '';
    if (label === '' || label.length > LABEL_MAX || !SECTION_ANCHOR_RE.test(anchor)) continue;
    valid.push({ label, anchor });
    if (valid.length === PAGE_NAVIGATION_MAX_ITEMS) break;
  }
  return valid;
}

function alignAt(value: unknown, tier: BreakpointTier): BlockAlign {
  const at = value !== null && typeof value === 'object' ? resolveResponsive<unknown>(value as ResponsiveProp<unknown>, tier, 'start') : value;
  return ALIGNS.includes(at as BlockAlign) ? (at as BlockAlign) : 'start';
}

/** The phone's alignment class, then one per larger breakpoint whose alignment differs (as `cms.Tabs`). */
function alignClasses(value: unknown, tier: BreakpointTier | null): string[] {
  const mobile = alignAt(value, tier ?? 'mobile');
  const classes = [`cmsc-pb-page-nav--align-${mobile}`];
  if (tier !== null) return classes;
  const tablet = alignAt(value, 'tablet');
  const desktop = alignAt(value, 'desktop');
  if (tablet !== mobile) classes.push(`cmsc-pb-page-nav--align-md-${tablet}`);
  if (desktop !== tablet) classes.push(`cmsc-pb-page-nav--align-lg-${desktop}`);
  return classes;
}

/**
 * Editor only: the anchors no element of the canvas carries, rechecked whenever
 * an element or an id of the canvas changes (a Section gains its anchor later).
 */
function useMissingAnchors(navRef: RefObject<HTMLElement | null>, anchors: readonly string[], editing: boolean): string[] {
  const [missing, setMissing] = useState<string[]>([]);
  const anchorsKey = anchors.join(' ');
  useEffect(() => {
    const doc = navRef.current?.ownerDocument;
    if (!editing || !doc) return undefined;
    const check = (): void => {
      const wanted = anchorsKey === '' ? [] : anchorsKey.split(' ');
      const next = [...new Set(wanted.filter((anchor) => doc.getElementById(anchor) === null))];
      setMissing((previous) => (previous.join(' ') === next.join(' ') ? previous : next));
    };
    check();
    const Mutation = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    if (typeof Mutation !== 'function' || !doc.body) return undefined;
    const observer = new Mutation(check);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['id'] });
    return () => observer.disconnect();
  }, [navRef, anchorsKey, editing]);
  return missing;
}

function PageNavigationBody({ props, tier }: { props: Parameters<PuckComponent<PageNavigationProps>>[0]; tier: BreakpointTier | null }): ReactNode {
  const { items, label, look, sticky, align, puck, ...box } = props;
  const editing = puck?.isEditing === true;
  const text = useCmsRenderPageNavigationText();
  const navRef = useRef<HTMLElement | null>(null);
  const links = pageNavigationItems(items);
  const anchors = links.map((link) => link.anchor);
  const isSticky = sticky === true;
  const [active, follow] = usePageNavigationSpy(navRef, anchors, { sticky: isSticky, enabled: !editing });
  const missing = useMissingAnchors(navRef, anchors, editing);
  const boxProps = { ...box, ...(editing ? { previewTier: 'desktop' as const } : {}) };

  if (links.length === 0) {
    if (!editing) return null;
    return (
      <BoxStyled {...boxProps}>
        <p className="cmsc-pb-page-nav__note">Pick a section for each link in the sidebar.</p>
      </BoxStyled>
    );
  }

  const own = typeof label === 'string' ? label.trim() : '';
  const contextLabel = text?.label?.trim() ?? '';
  const name = own !== '' && own.length <= NAV_LABEL_MAX ? own : contextLabel !== '' ? contextLabel : DEFAULT_NAV_LABEL;
  const classes = [
    'cmsc-pb-page-nav',
    `cmsc-pb-page-nav--${LOOKS.includes(look as PageNavigationLook) ? look : 'pill'}`,
    ...alignClasses(align, tier),
    isSticky ? 'cmsc-pb-page-nav--sticky' : '',
  ].filter(Boolean);

  return (
    <BoxStyled {...boxProps} className={isSticky ? 'cmsc-pb-page-nav-box cmsc-pb-page-nav-box--sticky' : 'cmsc-pb-page-nav-box'}>
      <nav ref={navRef} className={classes.join(' ')} aria-label={name}>
        <ul className="cmsc-pb-page-nav__list">
          {links.map((link, index) => (
            <li key={`${index}-${link.anchor}`}>
              <a
                className={`cmsc-pb-page-nav__link${active === index ? ' cmsc-pb-page-nav__link--active' : ''}`}
                href={`#${link.anchor}`}
                {...(active === index ? { 'aria-current': 'true' as const } : {})}
                onClick={() => follow(index)}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {editing && missing.length > 0 ? (
        <p className="cmsc-pb-page-nav__note" role="note">
          {`No element on this page has the anchor ${missing.map((anchor) => `#${anchor}`).join(', ')} yet.`}
        </p>
      ) : null}
    </BoxStyled>
  );
}

const PageNavigationEditingRender: PuckComponent<PageNavigationProps> = (props) => (
  <PageNavigationBody props={props} tier={usePreviewBreakpointTier()} />
);

const PageNavigationPublishedRender: PuckComponent<PageNavigationProps> = (props) => (
  <PageNavigationBody props={props} tier={null} />
);

/**
 * The package's anchor field: free text, normalised to the anchor grammar when
 * it loses focus or on Enter. The admin replaces it with the picker of the
 * page's section anchors (`createAnchorField` in `page-builder-admin`).
 */
function AnchorTextControl({
  value,
  onChange,
  readOnly,
  id,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  readOnly?: boolean | undefined;
  id?: string | undefined;
}): ReactElement {
  const stored = value ?? '';
  const [draft, setDraft] = useState(stored);
  useEffect(() => setDraft(stored), [stored]);
  const commit = (): void => {
    const normalised = normalizeAnchor(draft);
    setDraft(normalised);
    if (normalised !== stored) onChange(normalised);
  };
  return (
    <input
      type="text"
      {...(id !== undefined ? { id } : {})}
      className={PB_FIELD_INPUT_CLASS}
      readOnly={readOnly === true}
      value={draft}
      placeholder="section-anchor"
      onChange={(event): void => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event): void => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

const ANCHOR_TEXT_FIELD = {
  type: 'custom' as const,
  label: 'Section anchor',
  render: ({
    value,
    onChange,
    readOnly,
    field,
    id,
  }: {
    value: string | undefined;
    onChange: (value: string) => void;
    readOnly?: boolean;
    field: { label?: string };
    id?: string;
  }): ReactElement => (
    <FieldLabel label={field.label ?? 'Section anchor'} {...(readOnly === true ? { readOnly: true } : {})}>
      <AnchorTextControl value={value} onChange={onChange} readOnly={readOnly} id={id} />
    </FieldLabel>
  ),
};

const PAGE_NAVIGATION_FIELDS = {
  items: {
    type: 'array' as const,
    label: 'Links',
    max: PAGE_NAVIGATION_MAX_ITEMS,
    arrayFields: {
      label: { type: 'text' as const, label: 'Label' },
      anchor: ANCHOR_TEXT_FIELD,
    },
    defaultItemProps: { label: 'Section', anchor: '' },
    getItemSummary: (item: { label?: string }, index?: number) => item?.label || `Link ${(index ?? 0) + 1}`,
  },
  label: { type: 'text' as const, label: 'Accessible name' },
  look: {
    type: 'radio' as const,
    label: 'Look',
    options: [
      { label: 'Pill', value: 'pill' },
      { label: 'Underline', value: 'underline' },
    ],
  },
  align: alignField('Align', [
    { label: 'Left', value: 'start' },
    { label: 'Center', value: 'center' },
    { label: 'Right', value: 'end' },
  ]),
  sticky: createToggleField({ label: 'Stick to the top while scrolling' }),
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const pageNavigationConfig: ComponentConfig<PageNavigationProps> = {
  label: 'Page navigation',
  fields: PAGE_NAVIGATION_FIELDS as unknown as Fields<PageNavigationProps>,
  defaultProps: {
    items: [
      { label: 'Section 1', anchor: '' },
      { label: 'Section 2', anchor: '' },
    ],
    look: 'pill',
    ...DEFAULT_BOX_PROPS,
  } as unknown as PageNavigationProps,
  // Every field applies whatever is set: the host's field objects, as they are (focus is kept).
  resolveFields: (_data, params) => ((params?.fields as Fields<PageNavigationProps> | undefined) ?? (PAGE_NAVIGATION_FIELDS as unknown as Fields<PageNavigationProps>)),
  render: (props) =>
    props.puck?.isEditing ? <PageNavigationEditingRender {...props} /> : <PageNavigationPublishedRender {...props} />,
};

export const PageNavigation = withHideOn(pageNavigationConfig);
