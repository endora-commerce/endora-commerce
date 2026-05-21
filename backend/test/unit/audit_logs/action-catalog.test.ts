import { describe, expect, it } from 'vitest';
import {
  RECENT_ACTIVITY_ACTIONS,
  isRecentActivityAction,
  moduleForAction,
  type RecentActivityModule,
} from '../../../src/modules/audit_logs/action-catalog.js';

/**
 * Feature 024 / T002 — every token in the dashboard's allowlist maps to
 * exactly one in-scope source module, and unknown tokens are rejected by
 * the type guard. This is a pure-function test; no DB, no fixtures.
 */
describe('audit_logs action-catalog', () => {
  it('classifies every allowlisted token into catalog / inventory / price_lists', () => {
    const valid: ReadonlyArray<RecentActivityModule> = ['catalog', 'inventory', 'price_lists'];
    for (const action of RECENT_ACTIVITY_ACTIONS) {
      const mod = moduleForAction(action);
      expect(valid).toContain(mod);
    }
  });

  it('throws when an unknown token is passed to moduleForAction', () => {
    // The cast simulates a stale catalog file or a typo at a call site.
    expect(() => moduleForAction('totally_new.token' as never)).toThrow(/No module mapping/);
  });

  it('isRecentActivityAction accepts allowlisted tokens and rejects others', () => {
    expect(isRecentActivityAction('product.create')).toBe(true);
    expect(isRecentActivityAction('price_list.activate')).toBe(true);
    expect(isRecentActivityAction('stock_level.adjust')).toBe(true);
    // Real audit tokens that are NOT in this dashboard's scope.
    expect(isRecentActivityAction('setting.update')).toBe(false);
    expect(isRecentActivityAction('impersonation.start')).toBe(false);
    expect(isRecentActivityAction('product_link.create')).toBe(false);
    expect(isRecentActivityAction('totally_new.token')).toBe(false);
    expect(isRecentActivityAction('')).toBe(false);
  });

  it('contains a snake_case {resource}.{operation} token for every entry', () => {
    for (const action of RECENT_ACTIVITY_ACTIONS) {
      expect(action).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });
});
