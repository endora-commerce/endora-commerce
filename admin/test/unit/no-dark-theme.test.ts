/**
 * The Admin UI has one theme — issue #1810 (UX audit 2026-11-17 follow-up;
 * owner ruling 2026-11-22, option (a)).
 *
 * The kit's `theme.css` used to carry a `.dark { --background: … }` token block
 * that nothing applied: there is no theme switch and no `.dark` class on any
 * element. Applied by hand it was incomplete — the page background stayed light
 * while cards turned dark, and outline buttons went dark-on-dark. A handful of
 * `dark:` utilities sat beside it, and those were worse than dead: with no
 * `@custom-variant dark`, Tailwind 4 compiles `dark:` to
 * `@media (prefers-color-scheme: dark)`, so an operator whose OS is dark got
 * dark badges and dark-text notices on a light page.
 *
 * Dark mode is not a product requirement, so the tokens and the variants went.
 * This keeps them from coming back piecemeal: a dark theme is a feature — full
 * token coverage, a switch, contrast checks — not a block or a utility that a
 * single screen can add.
 *
 * The storefront has its own runtime `.is-dark` scope and is out of reach here.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The Admin UI's sources: repo-relative pathspecs, then the extensions that can carry a theme. */
const ADMIN_SOURCES = [
  'admin/src',
  'admin/index.html',
  'packages/admin-kit/theme.css',
  'packages/admin-kit/src',
  'packages/admin-shell/src',
  'packages/page-builder-admin/src',
  'packages/modules/*/src/admin/*',
];
const THEMEABLE = /\.(?:tsx?|css|html)$/;

/** What a dark theme is made of, each with the reason it is refused. */
const DARK_THEME: ReadonlyArray<readonly [string, RegExp]> = [
  // In a stylesheet only: in TypeScript `schemes.dark` is a page-builder colour scheme.
  ['a `.dark` selector', /\.dark\b(?!-)/],
  ['a `dark:` variant', /(?:^|[\s'"`:])dark:[a-z[@]/],
  ['a `prefers-color-scheme` rule', /prefers-color-scheme/],
  ['a `dark` variant definition', /@custom-variant\s+dark\b/],
  ['a `dark` class toggled on an element', /classList\.(?:add|toggle)\(\s*['"]dark['"]/],
];

/**
 * A `dark:` utility for the samples below, spelled so Tailwind's scanner — which
 * reads `admin/test` as well — does not find one in this file and compile it.
 */
const dark = (utility: string): string => ['dark', utility].join(':');

function sources(): string[] {
  const out = execFileSync('git', ['ls-files', '--', ...ADMIN_SOURCES], { cwd: repoRoot, encoding: 'utf8' });
  return out.split('\n').filter((file) => THEMEABLE.test(file) && !/\.test\.tsx?$/.test(file));
}

function darkThemeIn(text: string, file: string): string[] {
  return DARK_THEME.filter(([what]) => file.endsWith('.css') || what !== 'a `.dark` selector')
    .filter(([, pattern]) => pattern.test(text))
    .map(([what]) => what);
}

describe('the Admin UI carries no dark theme (#1810)', () => {
  it('no admin source declares `.dark` tokens, a `dark:` variant or a colour-scheme rule', () => {
    const files = sources();
    expect(files).toContain('packages/admin-kit/theme.css');
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) =>
      darkThemeIn(readFileSync(path.join(repoRoot, file), 'utf8'), file).map((what) => `${file}: ${what}`),
    );
    expect(offenders).toEqual([]);
  });

  it('tells a dark theme from the word "dark", so the rule above still means something', () => {
    expect(darkThemeIn('.dark {\n  --background: 0 0% 0%;\n}', 'theme.css')).toEqual(['a `.dark` selector']);
    expect(darkThemeIn('html.dark .card { color: red; }', 'theme.css')).toEqual(['a `.dark` selector']);
    expect(darkThemeIn('.btn--dark { color: red; }', 'theme.css')).toEqual([]);
    expect(darkThemeIn(`'bg-amber-50 ${dark('bg-amber-950')}'`, 'Page.tsx')).toEqual(['a `dark:` variant']);
    expect(darkThemeIn(`'md:${dark('text-white')}'`, 'Page.tsx')).toEqual(['a `dark:` variant']);
    expect(darkThemeIn('@media (prefers-color-scheme: dark) {}', 'theme.css')).toEqual(['a `prefers-color-scheme` rule']);
    expect(darkThemeIn('@custom-variant dark (&:where(.dark, .dark *));', 'index.css')).toEqual([
      'a `.dark` selector',
      'a `dark` variant definition',
    ]);
    expect(darkThemeIn("document.documentElement.classList.add('dark')", 'main.tsx')).toEqual([
      'a `dark` class toggled on an element',
    ]);
    // A page-builder colour scheme the storefront renders is content, not an admin theme.
    expect(darkThemeIn("schemes.dark.decorativeUrl; t('brand.schemes.dark'); { dark: 'Dark' }", 'BrandPage.tsx')).toEqual([]);
  });
});
