import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

/**
 * Feature 167 (FR-021, `contracts/storefront-navigation.md` §4) — the lint rule that
 * keeps every internal storefront path on the helper. A fixture with one violation per
 * selector is linted with the storefront's own config; the test asserts the exact set
 * of reported lines (the red proof), and that every adapter form passes.
 */

const STOREFRONT = fileURLToPath(new URL('../..', import.meta.url));
const RULE = 'no-restricted-syntax';

const FIXTURE = [
  "import Link from 'next/link';", // 1
  "import { redirect, permanentRedirect, useRouter } from 'next/navigation';", // 2
  "import { NextResponse, type NextRequest } from 'next/server';", // 3
  "import { LocalizedLink, useLocalizedPath } from '../lib/i18n/localized-link';", // 4
  "import { localizedPath, localeRedirect } from '../lib/i18n/navigation';", // 5
  'export function Bad({ slug, request }: { slug: string; request: NextRequest }) {', // 6
  '  const router = useRouter();', // 7
  "  if (slug === 'a') redirect('/login');", // 8  — selector 4 (literal)
  '  if (slug === \'b\') permanentRedirect(`/p/${slug}`);', // 9  — selector 4 (template)
  "  router.push('/cart');", // 10 — selector 5
  "  if (slug === 'c') return NextResponse.redirect(new URL('/login', request.url));", // 11 — selector 6
  '  return (', // 12
  '    <>', // 13
  '      <a href="/cart">a</a>', // 14 — selector 1
  "      <Link href={'/catalog'}>b</Link>", // 15 — selector 2
  '      <Link href={`/c/${slug}`}>c</Link>', // 16 — selector 3
  '    </>', // 17
  '  );', // 18
  '}', // 19
  'export async function Good({ slug }: { slug: string }) {', // 20
  '  const localize = useLocalizedPath();', // 21
  "  if (slug === 'x') await localeRedirect('/login');", // 22
  '  return (', // 23
  '    <>', // 24
  '      <LocalizedLink href="/cart">a</LocalizedLink>', // 25
  "      <a href={await localizedPath('/catalog')}>b</a>", // 26
  "      <a href={localize('/search')}>c</a>", // 27
  '      <a href="https://example.com/x">d</a>', // 28
  '      <a href="//cdn.example.com/x">e</a>', // 29
  '      <a href="#top">f</a>', // 30
  '    </>', // 31
  '  );', // 32
  '}', // 33
].join('\n');

/**
 * The fixture exists only in memory, so no TypeScript program contains it and the
 * project service refuses to parse it. The rule under test is syntactic, so the
 * typed promise rules (issue #1027) are switched off for it, with the type
 * information they need.
 */
function storefrontLinter(): ESLint {
  return new ESLint({
    cwd: STOREFRONT,
    overrideConfig: {
      languageOptions: { parserOptions: { projectService: false, project: null } },
      rules: {
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/no-misused-promises': 'off',
        '@typescript-eslint/await-thenable': 'off',
      },
    },
  });
}

async function reportedLines(filePath: string): Promise<number[]> {
  const eslint = storefrontLinter();
  const [result] = await eslint.lintText(FIXTURE, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === RULE)
    .map((m) => m.line)
    .sort((a, b) => a - b);
}

describe('the localized-path lint rule', () => {
  it('reports one finding per selector, on the expected lines, and none for the adapters', async () => {
    expect(await reportedLines(`${STOREFRONT}app/locale-href-fixture.tsx`)).toEqual([8, 9, 10, 11, 14, 15, 16]);
  });

  it('carries the message that names the helpers', async () => {
    const eslint = storefrontLinter();
    const [result] = await eslint.lintText(FIXTURE, { filePath: `${STOREFRONT}components/locale-href-fixture.tsx` });
    const message = result?.messages.find((m) => m.ruleId === RULE)?.message ?? '';
    expect(message).toContain('LocalizedLink');
    expect(message).toContain('specs/167-storefront-locale-path');
  });

  it('exempts the helper itself', async () => {
    expect(await reportedLines(`${STOREFRONT}lib/i18n/locale-path.ts`)).toEqual([]);
  });
});
