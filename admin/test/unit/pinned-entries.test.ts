import { describe, expect, it } from 'vitest';
import { Boxes, LayoutDashboard, ShoppingCart } from 'lucide-react';
import {
  pinDestination,
  pinMatchesExactly,
  reorderVisiblePins,
  resolvePinnedEntries,
  unpinDestination,
  visibleDestinations,
} from '../../../packages/admin-shell/src/lib/pinned-entries';
import type { NavItem, NavSection } from '../../../packages/admin-shell/src/components/sidebar/nav-types';

/**
 * Feature 164 — the shell's pure pin helpers
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §2.1, §2.3).
 *
 * The Pinned section and the palette's pin control read **one** map of visible
 * destinations, built with the sidebar's own predicate, so a pin can never show
 * a surface its original entry would not (FR-006, FR-027). Pins append and
 * never duplicate (FR-007), are never dropped or reordered by another change
 * (FR-008), and reordering keeps hidden pins in their slots (FR-009).
 */

const item = (to: string, extra: Partial<NavItem> = {}): NavItem => ({
  to,
  labelKey: `nav.${to}`,
  icon: Boxes,
  module: null,
  ...extra,
});

const SECTIONS: NavSection[] = [
  { key: 'main', labelKey: '', items: [item('/', { icon: LayoutDashboard })] },
  {
    key: 'sales',
    labelKey: 'appShell.section.sales',
    items: [item('/orders', { icon: ShoppingCart }), item('/orders/drafts'), item('/returns', { module: 'returns' })],
  },
  {
    key: 'catalog',
    labelKey: 'appShell.section.catalog',
    items: [
      item('/catalog/products'),
      // A second entry for the same destination in a later section.
      item('/orders', { module: 'crm' }),
      item('/secret', { requiredPermission: 'secret:read' }),
    ],
  },
];

const hide = (...hidden: string[]) => {
  const set = new Set(hidden);
  return (entry: NavItem): boolean =>
    !set.has(entry.to) && !(entry.requiredPermission === 'secret:read');
};

describe('visibleDestinations', () => {
  it('keeps the first visible entry per destination, in section order', () => {
    const map = visibleDestinations(SECTIONS, () => true);
    expect([...map.keys()]).toEqual([
      '/',
      '/orders',
      '/orders/drafts',
      '/returns',
      '/catalog/products',
      '/secret',
    ]);
    expect(map.get('/orders')!.sectionKey).toBe('sales');
    expect(map.get('/orders')!.item.module).toBeNull();
  });

  it('omits hidden entries, and falls through to a later visible duplicate', () => {
    const map = visibleDestinations(SECTIONS, (entry) => !(entry.to === '/orders' && entry.module === null));
    expect(map.get('/orders')!.sectionKey).toBe('catalog');
    const strict = visibleDestinations(SECTIONS, hide('/returns'));
    expect(strict.has('/returns')).toBe(false);
    expect(strict.has('/secret')).toBe(false);
  });

  it('matches a pinned row the way its original row matches (#1550)', () => {
    const map = visibleDestinations(SECTIONS, () => true);
    // `/` is always exact; `/orders` is exact only while its nested sibling
    // `/orders/drafts` is the screen open, and lights up on an order's detail.
    expect(pinMatchesExactly(map.get('/')!, '/orders')).toBe(true);
    expect(pinMatchesExactly(map.get('/orders')!, '/orders/drafts')).toBe(true);
    expect(pinMatchesExactly(map.get('/orders')!, '/orders/123')).toBe(false);
    expect(pinMatchesExactly(map.get('/returns')!, '/returns/7')).toBe(false);
  });
});

describe('resolvePinnedEntries', () => {
  it('returns the stored order and omits hidden and retired destinations', () => {
    const pins = ['/returns', '/retired', '/orders', '/secret'];
    const resolved = resolvePinnedEntries(pins, SECTIONS, hide());
    expect(resolved.map((pin) => pin.destination)).toEqual(['/returns', '/orders']);
    expect(resolved[0]!.sectionKey).toBe('sales');
    expect(pinMatchesExactly(resolved[1]!, '/orders/drafts')).toBe(true);
    expect(resolved[1]!.item.icon).toBe(ShoppingCart);
  });

  it('returns nothing when no pin is visible', () => {
    expect(resolvePinnedEntries(['/secret'], SECTIONS, hide())).toEqual([]);
  });
});

describe('pinDestination / unpinDestination', () => {
  it('appends at the end and never duplicates (FR-007)', () => {
    expect(pinDestination(['/orders'], '/returns')).toEqual(['/orders', '/returns']);
    expect(pinDestination(['/orders', '/returns'], '/orders')).toEqual(['/orders', '/returns']);
  });

  it('never drops or reorders an existing pin (FR-008)', () => {
    const many = Array.from({ length: 150 }, (_, i) => `/p${i}`);
    const next = pinDestination(many, '/new');
    expect(next.slice(0, 150)).toEqual(many);
    expect(next.at(-1)).toBe('/new');
  });

  it('removes only that destination', () => {
    expect(unpinDestination(['/a', '/b', '/c'], '/b')).toEqual(['/a', '/c']);
    expect(unpinDestination(['/a'], '/missing')).toEqual(['/a']);
  });
});

describe('reorderVisiblePins (FR-009)', () => {
  it('keeps hidden pins at their indices and fills the visible slots in the new order', () => {
    // `/h1` and `/h2` are hidden; the visible four are reordered.
    const stored = ['/a', '/h1', '/b', '/c', '/h2', '/d'];
    expect(reorderVisiblePins(stored, ['/d', '/a', '/b', '/c'])).toEqual([
      '/d',
      '/h1',
      '/a',
      '/b',
      '/h2',
      '/c',
    ]);
  });

  it('is the identity for the stored visible order', () => {
    const stored = ['/a', '/h1', '/b'];
    expect(reorderVisiblePins(stored, ['/a', '/b'])).toEqual(stored);
  });
});
