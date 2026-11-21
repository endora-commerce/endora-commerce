import { describe, expect, it } from 'vitest';
import { navItemMatchesExactly } from '../../../packages/admin-shell/src/components/sidebar/nav-match';

/**
 * Issue #1550 (UX audit SHELL-10) — a sidebar row lights up for the screens
 * beneath it unless a **more specific** sibling row is the one the operator is
 * on. `/settings` keeps one row for Settings, Groups and Cache (a tab strip
 * switches between them), while `pwa` still contributes `/settings/pwa` to the
 * same section: the old rule forced an exact match on `/settings` merely
 * because that sibling existed, so neither row was lit on `/settings/groups`.
 */
const SYSTEM = ['/settings', '/settings/pwa', '/credentials'];

describe('navItemMatchesExactly', () => {
  it('lets a parent row match the sub-screens no sibling row claims', () => {
    expect(navItemMatchesExactly('/settings', SYSTEM, '/settings/groups')).toBe(false);
    expect(navItemMatchesExactly('/settings', SYSTEM, '/settings/cache')).toBe(false);
    expect(navItemMatchesExactly('/settings', SYSTEM, '/settings')).toBe(false);
  });

  it('forces an exact match while a nested sibling row is the active one', () => {
    expect(navItemMatchesExactly('/settings', SYSTEM, '/settings/pwa')).toBe(true);
    expect(navItemMatchesExactly('/settings', SYSTEM, '/settings/pwa/push')).toBe(true);
  });

  it('does not treat a shared string prefix as nesting', () => {
    expect(navItemMatchesExactly('/settings', ['/settings', '/settings-x'], '/settings-x')).toBe(false);
  });

  it('always matches the home row exactly', () => {
    expect(navItemMatchesExactly('/', ['/', '/orders'], '/')).toBe(true);
    expect(navItemMatchesExactly('/', ['/', '/orders'], '/anything')).toBe(true);
  });
});
