import { useCallback, useId, useMemo, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, GripVertical } from 'lucide-react';
import { ADMIN_PINNED_GROUP_KEY } from '@endora-commerce/contracts';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { ResolvedPin } from '../../lib/pinned-entries.js';
import {
  useReorderList,
  type ReorderLabels,
  ReorderAnnouncer,
  TouchReorderButtons,
} from '@endora-commerce/admin-kit/components';
import type { NavItem, NavSection } from './nav-types.js';
import { PinToggleButton } from './PinToggleButton.js';

export interface PinnedSectionProps {
  /** The visible pins, in the admin's order (`resolvePinsFrom`). */
  pins: readonly ResolvedPin[];
  /** The composed sections, to name each pin's source section. */
  sections: readonly NavSection[];
  collapsed: boolean;
  onToggleCollapsed: (groupKey: string) => void;
  onUnpin: (pin: ResolvedPin) => void;
  /** The visible pins' destinations in their new order (FR-009). */
  onReorder: (visibleOrder: string[]) => void;
  navLabel: (item: NavItem) => string;
  /** The mobile drawer: pin controls always shown, 44 px targets. */
  touch: boolean;
}

/**
 * Feature 164 — the sidebar's Pinned section, expanded and in the mobile drawer
 * (FR-001 – FR-005, FR-009; research R-7). The rail renders it as a
 * `RailSection` variant instead, without reordering.
 *
 * Every row is the original entry's own object — its icon, its label, its
 * `end` flag — so the active state matches the original's (FR-003), and a pin
 * whose original is hidden never reaches this component (FR-006). It reuses the
 * sidebar's group, label and item classes; it folds under the group key
 * `pinned` like any other group (FR-013). Nothing is rendered without a visible
 * pin — no heading, no placeholder (FR-002).
 *
 * Reordering is the kit's `useReorderList` over the **visible** pins — pointer
 * drag, the keyboard grab mode on each row's handle (one Tab stop for the whole
 * list), and the touch up/down buttons — announced in the section's own live
 * region. The caller merges the new visible order back slot by slot, so hidden
 * pins keep their places.
 */
export function PinnedSection({
  pins,
  sections,
  collapsed,
  onToggleCollapsed,
  onUnpin,
  onReorder,
  navLabel,
  touch,
}: PinnedSectionProps): ReactNode {
  const t = useTranslation('core');
  const baseId = useId();

  const labels = useMemo<ReorderLabels>(() => {
    const say =
      (key: string) =>
      ({ name, index, total }: { name: string; index: number; total: number }): string =>
        t(`appShell.pinned.reorder.${key}`, { label: name, index, total });
    return {
      handle: say('handle'),
      grabbed: say('grabbed'),
      moving: say('moving'),
      dropped: say('dropped'),
      cancelled: say('cancelled'),
      moved: say('moved'),
      atStart: say('atStart'),
      atEnd: say('atEnd'),
    };
  }, [t]);

  const items = useMemo(() => [...pins], [pins]);
  const getId = useCallback((pin: ResolvedPin): string => pin.destination, []);
  const getLabel = useCallback((pin: ResolvedPin): string => navLabel(pin.item), [navLabel]);
  const reorder = useReorderList<ResolvedPin>({
    items,
    getId,
    getLabel,
    onReorder: (next): void => onReorder(next.map((pin) => pin.destination)),
    labels,
  });

  if (pins.length === 0) return null;

  const sourceOf = (sectionKey: string): string => {
    const section = sections.find((candidate) => candidate.key === sectionKey);
    return section?.labelKey
      ? t('appShell.pinned.fromSection', { section: t(section.labelKey) })
      : t('appShell.pinned.fromMain');
  };

  return (
    <div
      data-testid="sidebar-pinned"
      className={cn(
        'b2b-sidebar__group',
        collapsed && 'b2b-sidebar__group--collapsed',
      )}
    >
      <button
        type="button"
        className="b2b-sidebar__group-label"
        aria-expanded={!collapsed}
        onClick={(): void => onToggleCollapsed(ADMIN_PINNED_GROUP_KEY)}
      >
        <ChevronDown size={11} />
        <span>{t('appShell.pinned.heading')}</span>
      </button>
      {/* A list, so each row's position (`aria-posinset`) is a supported attribute. */}
      <div className="b2b-sidebar__items" role="list" aria-label={t('appShell.pinned.heading')}>
        {items.map((pin, index) => {
          const Icon = pin.item.icon;
          const label = navLabel(pin.item);
          const sourceId = `${baseId}-from-${index}`;
          const { ref: handleRef, ...handleProps } = reorder.getHandleProps(pin, index);
          return (
            <div
              key={pin.destination}
              role="listitem"
              {...reorder.getItemProps(pin, index)}
              className={cn(
                'b2b-nav-row b2b-nav-row--pinned',
                reorder.grabbedId === pin.destination && 'is-grabbed',
                reorder.draggingId === pin.destination && 'is-dragging',
                reorder.dropTargetId === pin.destination && 'is-drop-target',
              )}
            >
              <button
                ref={handleRef}
                {...handleProps}
                className={cn('b2b-nav-pin b2b-nav-reorder-handle', touch && 'b2b-nav-pin--touch')}
              >
                <GripVertical size={14} aria-hidden="true" />
              </button>
              <NavLink
                to={pin.destination}
                end={pin.end}
                aria-describedby={sourceId}
                draggable={false}
                className={({ isActive }): string => cn('b2b-nav-item', isActive && 'is-active')}
              >
                <Icon size={16} />
                <span style={{ flex: 1 }}>{label}</span>
              </NavLink>
              <span id={sourceId} className="sr-only">
                {sourceOf(pin.sectionKey)}
              </span>
              <TouchReorderButtons
                onMoveUp={(): void => reorder.moveBy(pin.destination, -1)}
                onMoveDown={(): void => reorder.moveBy(pin.destination, 1)}
                disableUp={index === 0}
                disableDown={index === items.length - 1}
              />
              <PinToggleButton label={label} pinned touch={touch} onToggle={(): void => onUnpin(pin)} />
            </div>
          );
        })}
      </div>
      <ReorderAnnouncer message={reorder.announcement} />
    </div>
  );
}
