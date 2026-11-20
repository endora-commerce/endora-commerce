import {
  createContext,
  useContext,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../lib/utils.js';
import { useTranslation } from '../i18n/useTranslation.js';

/**
 * In-page tabs — issue #1445 (UX audit 2026-11-17, DS-12).
 *
 * The WAI-ARIA tabs pattern with automatic activation, built from the product
 * editor's working implementation (feature 174, FR-105/FR-107): one tab in the
 * tab order (roving `tabindex`), ←/→ move and select, Home/End jump to the
 * ends, every tab names the panel it controls (`aria-controls`) and the panel
 * names its tab back (`aria-labelledby`). The look is the design system's
 * `.b2b-tabs` / `.b2b-tab`, the same as `RouteTabs`, so a route strip and a
 * state strip cannot be told apart by an operator (Jakob, Similarity).
 *
 * **One panel per strip.** Only the selected tab's content is rendered, in one
 * `TabPanel` whose id is derived from `idBase`; every tab's `aria-controls`
 * points at it. That is what every strip in the admin already did, and it keeps
 * a panel's data from loading until its tab is opened.
 *
 * **No tabs inside tabs.** A second level of tabs inside a tab panel hides
 * content two clicks deep and gives a keyboard user two strips with the same
 * keys. A second level becomes `Section`s. In development a `Tabs` rendered
 * inside a `TabPanel` logs a warning (a `ModalDialog` opened from a panel is a
 * new context and does not count).
 *
 * Tabs are always controlled: `value` + `onValueChange(next)`. A screen that
 * keeps the tab in the URL (`?tab=`) writes the search params there.
 */

export interface TabItem<V extends string = string> {
  value: V;
  /** The visible name. A string, because it is also the start of the accessible name with a count. */
  label: string;
  /** Decorative; rendered `aria-hidden`. */
  icon?: ReactNode;
  /**
   * A count shown as a badge after the label (`RecordTabs`' notes, messages,
   * links). Zero draws nothing: a tab with a number has something behind it.
   */
  count?: number;
  /**
   * The accessible name while `count > 0`, when "items" is not what is counted
   * ("Messages, unread: 2"). It must start with `label`, so the tab can still be
   * asked for by voice (WCAG 2.5.3). Default: the kit's `common.tabs.counted`.
   */
  countLabel?: string;
  /** A disabled tab is skipped by the arrow keys and cannot be selected. */
  disabled?: boolean;
  /**
   * The tab's section holds unsaved changes (an RFQ's Modify draft): a dot
   * after the label, and these words ("unsaved changes") added to the
   * accessible name, so the colour is never the one carrier (SC 1.4.1).
   */
  unsaved?: string | undefined;
}

export interface TabsProps<V extends string = string> {
  items: readonly TabItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /**
   * The ids' common prefix: tab `${idBase}-tab-${value}`, panel
   * `${idBase}-tabpanel` (`tabId` / `tabPanelId`). Unique on the page.
   */
  idBase: string;
  /** Names the strip — "Product sections". One of the two is required by the pattern. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

/** The id of the tab for `value` in the strip `idBase`. */
export function tabId(idBase: string, value: string): string {
  return `${idBase}-tab-${value}`;
}

/** The id of the strip's one panel. */
export function tabPanelId(idBase: string): string {
  return `${idBase}-tabpanel`;
}

/**
 * The tab a key moves to from `current`, or `null` for a key the strip does
 * not handle. Disabled tabs are skipped; the arrows wrap around.
 */
export function nextTabValue<V extends string>(
  items: readonly TabItem<V>[],
  current: V,
  key: string,
): V | null {
  const enabled = items.filter((item) => !item.disabled);
  const count = enabled.length;
  if (count === 0) return null;
  const index = enabled.findIndex((item) => item.value === current);
  let next: number;
  switch (key) {
    case 'ArrowRight':
      next = index < 0 ? 0 : (index + 1) % count;
      break;
    case 'ArrowLeft':
      next = index < 0 ? count - 1 : (index - 1 + count) % count;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = count - 1;
      break;
    default:
      return null;
  }
  return enabled[next]!.value;
}

/**
 * `true` below a `TabPanel`. Exported for `ModalDialog`, which resets it: a
 * dialog opened from a panel is not a second level of the page's tabs.
 */
export const TabPanelContext = createContext(false);

const warnedNested = new Set<string>();

function warnNestedTabs(idBase: string): void {
  if (!import.meta.env.DEV || warnedNested.has(idBase)) return;
  warnedNested.add(idBase);
  console.warn(
    `[admin-kit] Tabs "${idBase}" is rendered inside a TabPanel. ` +
      'Tabs inside tabs are not allowed (issue #1445): make the second level Sections.',
  );
}

/** A counted tab's name, with the unsaved words after it when the section holds a draft. */
function countedName(name: string, unsaved: string | undefined): string {
  return unsaved ? `${name} (${unsaved})` : name;
}

export function Tabs<V extends string>(props: TabsProps<V>): ReactNode {
  const { items, value, onValueChange, idBase, className } = props;
  const t = useTranslation('core');
  const insidePanel = useContext(TabPanelContext);
  if (insidePanel) warnNestedTabs(idBase);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  // A value no tab carries would leave the strip with no stop in the tab order.
  const selectedValue = items.some((item) => item.value === value && !item.disabled)
    ? value
    : items.find((item) => !item.disabled)?.value;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const next = nextTabValue(items, value, event.key);
    if (next === null) return;
    event.preventDefault();
    tabRefs.current.get(next)?.focus();
    if (next !== value) onValueChange(next);
  };

  return (
    <div className={cn('b2b-tabs-scroll', className)}>
      <div
        className="b2b-tabs"
        role="tablist"
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']}
      >
        {items.map((item) => {
          const selected = item.value === selectedValue;
          const count = item.count ?? 0;
          return (
            <button
              key={item.value}
              ref={(node): void => {
                if (node) tabRefs.current.set(item.value, node);
                else tabRefs.current.delete(item.value);
              }}
              id={tabId(idBase, item.value)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={tabPanelId(idBase)}
              // A bare number says nothing read aloud: the name says what is counted.
              aria-label={
                count > 0
                  ? countedName(item.countLabel ?? t('common.tabs.counted', { label: item.label, count }), item.unsaved)
                  : undefined
              }
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cn('b2b-tab', selected && 'is-active')}
              onClick={(): void => {
                if (item.value !== value) onValueChange(item.value);
              }}
              onKeyDown={onKeyDown}
            >
              {item.icon ? (
                <span aria-hidden="true" className="inline-flex shrink-0 [&_svg]:size-4">
                  {item.icon}
                </span>
              ) : null}
              {item.label}
              {count > 0 ? (
                <>
                  {/* A real space, so a copy of the strip reads "Links 2" and not "Links2". */}
                  {' '}
                  <span className="b2b-badge tabular-nums">{count}</span>
                </>
              ) : null}
              {item.unsaved ? (
                <>
                  {/* A real space, as for the count: the name reads "Modify (unsaved changes)". */}
                  {' '}
                  <span
                    aria-hidden="true"
                    className="ml-1 size-2 shrink-0 rounded-full bg-amber-500"
                    data-testid="tab-unsaved-dot"
                  />
                  <span className="sr-only">{`(${item.unsaved})`}</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface TabPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'role'> {
  /** The strip's `idBase`. */
  idBase: string;
  /** The selected tab's value — the panel is labelled by that tab. */
  value: string;
  children?: ReactNode;
}

/**
 * The strip's one panel. Focusable (`tabIndex` 0 by default, as the pattern
 * asks for a panel that may hold no focusable content); pass `-1` for a panel a
 * screen only focuses programmatically.
 */
export function TabPanel({ idBase, value, tabIndex = 0, children, ...rest }: TabPanelProps): ReactNode {
  return (
    <TabPanelContext.Provider value>
      <div
        role="tabpanel"
        id={tabPanelId(idBase)}
        aria-labelledby={tabId(idBase, value)}
        tabIndex={tabIndex}
        {...rest}
      >
        {children}
      </div>
    </TabPanelContext.Provider>
  );
}

export interface RecordTabsProps<V extends string = string> extends TabsProps<V> {
  /** The selected tab's content. */
  children?: ReactNode;
  /** The panel's attributes — `aria-busy`, `tabIndex`, a class. */
  panelProps?: Omit<TabPanelProps, 'idBase' | 'value' | 'children'>;
  /** The frame's class. */
  className?: string;
}

/**
 * A record's sections — the product editor's, an opportunity's, a project's:
 * one card, the strip across its top, the selected section's content as its
 * body. Items may carry a `count` (notes, messages, links).
 */
export function RecordTabs<V extends string>(props: RecordTabsProps<V>): ReactNode {
  const { children, panelProps, className, ...tabs } = props;
  return (
    <div className={cn('b2b-card', className)}>
      <div className="overflow-hidden px-1 pt-1">
        <Tabs {...tabs} />
      </div>
      <TabPanel
        {...panelProps}
        idBase={tabs.idBase}
        value={tabs.value}
        className={cn('b2b-card__body', panelProps?.className)}
      >
        {children}
      </TabPanel>
    </div>
  );
}
