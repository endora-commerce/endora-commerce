import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_RENDERING,
  UNKNOWN_RENDERING,
  formatRelative,
  renderActivity,
} from '../../../src/modules/home/activity-render';

/**
 * Feature 024 / T013 — pure-function tests for the action-token →
 * icon + verb mapping plus the relative-time formatter. No DOM needed.
 */

// Mirror the backend allowlist verbatim. This duplication is intentional:
// if either side adds a token without updating the other, this test fails.
const ALLOWLIST = [
  'product.create',
  'product.update',
  'product.archive',
  'product.unarchive',
  'product.bulk_update',
  'warehouse.create',
  'warehouse.update',
  'warehouse.deactivate',
  'warehouse.reactivate',
  'low_stock_threshold.create',
  'low_stock_threshold.update',
  'low_stock_threshold.delete',
  'stock_level.adjust',
  'stock_level.bulk_import',
  'price_list.create',
  'price_list.update',
  'price_list.activate',
  'price_list.draftify',
  'price_list.duplicate',
  'price_list.expire',
  'price_list.products_replace',
  'price_list.bracket_update',
];

describe('renderActivity', () => {
  it('has an entry for every token in the dashboard allowlist', () => {
    for (const action of ALLOWLIST) {
      const r = ACTIVITY_RENDERING[action];
      expect(r, `missing rendering for ${action}`).toBeDefined();
      expect(r!.verbKey).toMatch(/^home\.activity\.verb\./);
      expect(['catalog', 'inventory', 'price_lists']).toContain(r!.module);
    }
  });

  it('falls back to UNKNOWN_RENDERING for tokens not in the catalog', () => {
    const r = renderActivity('totally_new.token');
    expect(r).toBe(UNKNOWN_RENDERING);
    expect(r.verbKey).toBe('home.activity.verb.unknown');
  });

  it('returns the catalog entry verbatim for a known token', () => {
    const r = renderActivity('product.create');
    expect(r).toBe(ACTIVITY_RENDERING['product.create']);
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-05-20T12:00:00.000Z').getTime();

  it('returns "justNow" within a minute', () => {
    expect(formatRelative('2026-05-20T11:59:30.000Z', now).key).toBe('home.activity.time.justNow');
  });

  it('returns minutesAgo with a count when between 1 and 59 minutes', () => {
    const r = formatRelative('2026-05-20T11:58:00.000Z', now);
    expect(r.key).toBe('home.activity.time.minutesAgo');
    expect(r.params).toEqual({ count: 2 });
  });

  it('returns hoursAgo when between 1 and 23 hours', () => {
    const r = formatRelative('2026-05-20T05:00:00.000Z', now);
    expect(r.key).toBe('home.activity.time.hoursAgo');
    expect(r.params).toEqual({ count: 7 });
  });

  it('returns yesterday at ~24 h', () => {
    const r = formatRelative('2026-05-19T12:00:00.000Z', now);
    expect(r.key).toBe('home.activity.time.yesterday');
  });

  it('returns daysAgo when older than yesterday', () => {
    const r = formatRelative('2026-05-15T12:00:00.000Z', now);
    expect(r.key).toBe('home.activity.time.daysAgo');
    expect(r.params).toEqual({ count: 5 });
  });

  it('handles invalid timestamps gracefully', () => {
    expect(formatRelative('not-a-date', now).key).toBe('home.activity.time.justNow');
  });
});
