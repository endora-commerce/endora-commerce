import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Issue #1784 — every top-bar control is a 44 × 44 px target on a coarse
 * pointer (Fitts's Law; `.claude/skills/ux-laws/SKILL.md` § Fitts), from one
 * shared rule, while a mouse keeps the 34 px desktop density.
 *
 * jsdom evaluates no media query and lays nothing out, so the property is held
 * in two halves: the rule is read where it is decided — the kit stylesheet —
 * and its selector is then matched against the controls the real top bar
 * renders, with the real bell and language picker. A control added to the bar
 * later fails here until the shared rule reaches it, and a control given its
 * own coarse-pointer size fails because the rule must stay the only one.
 */

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/components/notifications/useAdminNotifications', () => ({
  useAdminNotifications: () => ({
    items: [],
    unreadCount: 3,
    loading: false,
    error: null,
    refresh: async () => {},
    markRead: async () => {},
    markAllRead: async () => {},
  }),
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

const coreBundle = passthroughBundle('core', [
  'appShell.brand.text',
  'appShell.nav.home',
  'appShell.mobileMenu.open',
  'appShell.search.openPalette',
  'appShell.topbar.notifications',
  'appShell.topbar.notificationsUnread',
  'appShell.languageIndicator.label',
  'appShell.profileMenu.profile',
]);

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

const repoRoot = resolve(__dirname, '../../..');
const themeCss = readFileSync(resolve(repoRoot, 'packages/admin-kit/theme.css'), 'utf8');

/** The bodies of every `@media (pointer: coarse)` block, braces balanced. */
function coarseBlocks(css: string): string[] {
  const blocks: string[] = [];
  const opener = /@media\s*\(pointer:\s*coarse\)\s*\{/g;
  for (let match = opener.exec(css); match; match = opener.exec(css)) {
    let depth = 1;
    let i = opener.lastIndex;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    blocks.push(css.slice(opener.lastIndex, i - 1));
  }
  return blocks;
}

interface Rule {
  selector: string;
  body: string;
}

function rulesIn(block: string): Rule[] {
  return [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim().replace(/\s+/g, ' '),
    body: m[2]!,
  }));
}

const coarseRules = coarseBlocks(themeCss).flatMap(rulesIn);
const topbarRules = coarseRules.filter((rule) => rule.selector.includes('b2b-topbar'));
const sizeRules = topbarRules.filter(
  (rule) => /min-width:\s*44px/.test(rule.body) && /min-height:\s*44px/.test(rule.body),
);

function renderShell(mobile: boolean): HTMLElement {
  setMobileViewport(mobile);
  renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: () => {} }}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<div>Home content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: [...everyDeclaredModule(), 'admin_notifications'] }) },
    ),
    coreBundle,
  );
  return document.querySelector<HTMLElement>('.b2b-topbar')!;
}

/**
 * The bar's controls. The breadcrumb trail is excluded: its links are inline
 * text in a sentence-like trail, which WCAG 2.5.8 exempts, and growing each to
 * 44 px would pad a short "Home" with dead space the trail cannot spare.
 */
function controls(topbar: HTMLElement): HTMLElement[] {
  return [...topbar.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [tabindex]')].filter(
    (el) => !el.closest('.b2b-topbar__crumbs, .b2b-topbar__crumbs-inner'),
  );
}

describe('AppShell top bar — 44 px touch targets on a coarse pointer (#1784)', () => {
  it('sizes the top bar from exactly one shared coarse-pointer rule', () => {
    expect(sizeRules, 'one rule sets the 44 px minimum for the whole bar').toHaveLength(1);
    const others = topbarRules.filter((rule) => rule !== sizeRules[0] && /\b(?:min-)?(?:width|height)\s*:/.test(rule.body));
    expect(others, 'no top-bar control carries a coarse-pointer size of its own').toEqual([]);
  });

  it.each([
    ['desktop', false],
    ['mobile', true],
  ] as const)('reaches every control the %s top bar renders', (_label, mobile) => {
    const topbar = renderShell(mobile);
    const found = controls(topbar);
    // Palette, bell, language picker and profile — plus the drawer button on mobile.
    expect(found.length).toBeGreaterThanOrEqual(mobile ? 5 : 4);
    const missed = found
      .filter((el) => !el.matches(sizeRules[0]!.selector))
      .map((el) => el.getAttribute('aria-label') ?? el.outerHTML.slice(0, 80));
    expect(missed).toEqual([]);
  });

  it('gives no top-bar control a per-control coarse-pointer utility', () => {
    for (const file of [
      'packages/admin-shell/src/components/AppShell.tsx',
      'packages/admin-shell/src/components/LanguagePicker.tsx',
      'packages/admin-shell/src/components/notifications/NotificationBell.tsx',
    ]) {
      expect(readFileSync(resolve(repoRoot, file), 'utf8'), file).not.toMatch(/pointer-coarse:/);
    }
  });

  it('keeps the 34 px desktop density for a fine pointer', () => {
    const base = rulesIn(themeCss).find((rule) => rule.selector === '.b2b-topbar__icon-btn');
    expect(base?.body).toMatch(/width:\s*34px;\s*height:\s*34px/);
  });

  it('keeps the profile avatar a 28 px circle inside its 44 px target', () => {
    const avatar = topbarRules.find((rule) => rule.selector.includes('b2b-avatar'));
    // The hit area grows with padding, not by inflating the visible box (Fitts).
    expect(avatar?.body).toMatch(/padding:\s*8px/);
    expect(avatar?.body).toMatch(/background-clip:\s*content-box/);
  });
});
