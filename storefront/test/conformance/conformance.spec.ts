/* eslint-disable no-console -- a CI job: stdout is its interface, and the
   `read:` line, the three self-declarations and the sentence saying what a
   green does not mean are all output rather than diagnostics. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';

import { formatMoney } from '../../lib/i18n/money';
import { tForLocale } from '../../lib/i18n/messages';
import { canonicalPath } from '../../lib/seo/route-seo';
import {
  assertServedPage,
  classifyAxeRuns,
  classifyKeyboardTraversal,
  classifyReducedMotion,
  runRefusal,
  targetOf,
  WHAT_A_GREEN_DOES_NOT_MEAN,
  type AxeRun,
  type ConformanceFinding,
  type KeyboardStep,
  type ReducedMotionObservation,
  type ReportedViolation,
} from './assertions';
import { KNOWN_ACCESSIBILITY_VIOLATIONS } from './known-violations';
import {
  buildConformancePlan,
  planRefusal,
  type FixtureManifest,
  type PlannedPage,
  type RouteDeclaration,
} from './plan';

/**
 * `conformance:storefront` — the booted job (`specs/098-storefront-ssr-seo-a11y-suite/`
 * Phase 4; `contracts/accessibility-floor.md` §4).
 *
 * This file is **plumbing**. It collects two observations per representative
 * page — the bytes a plain `fetch` received, and an axe run in a real browser —
 * and hands them to `assertions.ts`, which is where every verdict is decided
 * and which touches neither the network nor a browser. That separation is
 * `scripts/lib/boot-gate-assert.sh`'s, for its reason: a gate whose judgement
 * can only run against a booted stack is a gate nobody can prove goes red.
 *
 * ## One test, deliberately
 *
 * The verdict is a reconciliation across pages — a ledger entry is stale only
 * if **no** page found it, a short fetch is only visible once every fetch is
 * done — so it is one test with one report rather than one test per page. What
 * a per-page split would buy is a prettier reporter; what it would cost is the
 * two-way half of the ledger, which is the half that makes a repair prove
 * itself.
 *
 * ## How it is run
 *
 * `scripts/conformance-storefront.sh` boots the stack and invokes it. The
 * findings are written to `test-results/conformance-findings.txt` in the
 * estate's `<kind>: <sentence>` grammar, and the shell decides the exit code
 * from them — 2 for a refusal, 1 for a finding — exactly as
 * `scripts/boot-gate.sh` does. Running `playwright test` directly against a
 * booted stack works too and answers 1 or 0.
 */

const STOREFRONT_URL = process.env['STOREFRONT_URL'] ?? 'http://127.0.0.1:3000';
const BACKEND_URL = process.env['PUBLIC_API_BASE_URL'] ?? 'http://127.0.0.1:3001';
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const APP_ROOT = 'storefront/app';
const FINDINGS_FILE = resolve(REPO_ROOT, 'storefront/test-results/conformance-findings.txt');
const PREFIX = '[storefront-conformance]';

// ---------------------------------------------------------------------------
// The three inputs, read the way a real run reads them
// ---------------------------------------------------------------------------

/**
 * Every route's own SEO declaration, **imported** rather than parsed.
 *
 * The declaration is a TypeScript module the storefront itself imports, so the
 * honest way to read it is to evaluate it. Parsing its source text would be a
 * second reader of a file that already has one.
 */
async function loadDeclarations(): Promise<readonly RouteDeclaration[]> {
  const appDirectory = resolve(REPO_ROOT, APP_ROOT);
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'seo.ts') found.push(full);
    }
  };
  try {
    walk(appDirectory);
  } catch {
    // A tree that is not there contributes nothing; `no-declaration` is what
    // refuses over the absence, from the record rather than from this walk.
  }
  found.sort();

  const declarations: RouteDeclaration[] = [];
  for (const path of found) {
    const module = (await import(pathToFileURL(path).href)) as {
      seo?: { route?: string; jsonLd?: readonly string[] };
    };
    const seo = module.seo;
    if (seo?.route === undefined || seo.jsonLd === undefined) continue;
    declarations.push({
      source: relative(REPO_ROOT, path).split(sep).join('/'),
      route: seo.route,
      jsonLd: seo.jsonLd,
    });
  }
  return declarations;
}

/** `next build`'s own enumeration of what it built — the second author. */
function loadRouteManifest(): Record<string, string> | null {
  try {
    return JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'storefront/.next/app-path-routes-manifest.json'), 'utf8'),
    ) as Record<string, string>;
  } catch {
    return null;
  }
}

/** What the seeded platform produced, written by the fixture seed. */
function loadFixtures(): FixtureManifest | null {
  const declared = process.env['CONFORMANCE_FIXTURES'];
  try {
    return JSON.parse(
      readFileSync(
        declared !== undefined && declared.length > 0
          ? declared
          : resolve(REPO_ROOT, 'storefront/test/conformance/fixtures.json'),
        'utf8',
      ),
    ) as FixtureManifest;
  } catch {
    return null;
  }
}

/**
 * The module set the platform composed, asked of the platform itself.
 *
 * §4.4's second self-declaration. A page whose content comes from a
 * switched-off module renders without it (Principle XVII), so a reader who does
 * not know which modules were present will over-read a green.
 */
async function composedModules(): Promise<{ total: number; present: number } | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/storefront/module-presence`);
    if (!response.ok) return null;
    const body = (await response.json()) as { modules?: { id: string; present: boolean }[] };
    const modules = body.modules ?? [];
    return { total: modules.length, present: modules.filter((one) => one.present).length };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Turning a planned page into an observation
// ---------------------------------------------------------------------------

/**
 * The currency's own affix, as `Intl` renders it for this channel.
 *
 * Derived from the storefront's **own** formatter rather than from a table of
 * symbols: a page shows a price in whatever `formatMoney` produces, so that is
 * what the assertion has to look for. `formatMoney(0, …)` and then everything
 * that is not a digit, a separator or a space.
 */
function currencyAffix(currency: string, locale: string): string {
  return formatMoney(0, currency, locale)
    .replace(/[\d\s .,]/gu, '')
    .trim();
}

async function fetchPage(page: PlannedPage, currency: string, locale: string) {
  const url = `${STOREFRONT_URL}${page.url}`;
  const quotePhrase = tForLocale(locale)('product.requestQuote');
  let status = 0;
  let html = '';
  try {
    // A plain `fetch` executes no JavaScript, so what comes back is what a
    // crawler receives (FR-030). No browser establishes this and none may.
    const response = await fetch(url, { headers: { 'accept-language': locale } });
    status = response.status;
    html = await response.text();
  } catch (error) {
    status = 0;
    html = error instanceof Error ? error.message : String(error);
  }
  const kind = page.subject?.kind;
  return {
    route: page.route,
    url: page.url,
    status,
    html,
    declaredJsonLd: page.jsonLd,
    expectedCanonical: canonicalPath(page.route, { slug: page.subject?.segments }),
    domainContent:
      kind === 'product'
        ? {
            heading: page.subject?.name ?? '',
            priceOrQuote: { currencyAffix: currencyAffix(currency, locale), quotePhrase },
          }
        : kind === 'category'
          ? { heading: page.subject?.name ?? '', linksProducts: true }
          : null,
  };
}

/** The axe pass and the reduced-motion observation, in one page load. */
async function inspectInBrowser(
  browser: Browser,
  page: PlannedPage,
  locale: string,
): Promise<{ axe: AxeRun; motion: ReducedMotionObservation }> {
  const context = await browser.newContext({ reducedMotion: 'reduce', locale });
  const tab = await context.newPage();
  try {
    await tab.goto(`${STOREFRONT_URL}${page.url}`, { waitUntil: 'domcontentloaded' });
    // `.claude/skills/ux-laws/SKILL.md` § 4's rules and no second statement of
    // them: the tags are the WCAG 2.2 AA scope, and which rules that is stays
    // axe's answer rather than a list kept here (FR-040).
    const results = await new AxeBuilder({ page: tab })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const motion = await tab.evaluate(() => {
      const animating: string[] = [];
      for (const element of Array.from(document.querySelectorAll('*'))) {
        const style = getComputedStyle(element);
        if (style.animationName === 'none' || style.animationName === '') continue;
        if (style.animationDuration === '0s' || style.animationDuration === '') continue;
        animating.push(
          `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.split(/\s+/u)[0]}` : ''}`,
        );
      }
      return {
        matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        animating: animating.slice(0, 20),
      };
    });
    return {
      axe: {
        route: page.route,
        violations: results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact ?? null,
          help: violation.help,
          nodes: violation.nodes.map((node) => ({ target: node.target })),
        })),
        rulesRun:
          results.violations.length +
          results.passes.length +
          results.incomplete.length +
          results.inapplicable.length,
      },
      motion: {
        route: page.route,
        mediaQueryMatches: motion.matches,
        animating: motion.animating,
      },
    };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// The keyboard traversal of the primary path
// ---------------------------------------------------------------------------

/**
 * Tab until the focused element matches, or give up.
 *
 * The keyboard and nothing else: no `click`, no `focus()`, no selector-driven
 * shortcut. That is the whole assertion — a control a selector can reach and
 * `Tab` cannot is a control a keyboard reader does not have.
 */
async function tabUntil(page: Page, selector: string, limit = 120): Promise<boolean> {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const matched = await page.evaluate((candidate) => {
      const active = document.activeElement;
      return active !== null && active.matches(candidate);
    }, selector);
    if (matched) return true;
  }
  return false;
}

async function traversePrimaryPath(
  browser: Browser,
  locale: string,
  categoryUrl: string,
): Promise<{
  steps: KeyboardStep[];
  skipLink: { present: boolean; focusable: boolean };
}> {
  const context = await browser.newContext({ reducedMotion: 'reduce', locale });
  const page = await context.newPage();
  const steps: KeyboardStep[] = [];
  const t = tForLocale(locale);
  try {
    await page.goto(`${STOREFRONT_URL}/`, { waitUntil: 'domcontentloaded' });
    const present = (await page.locator('a[href^="#"]').count()) > 0;
    await page.keyboard.press('Tab');
    const focusable = await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLAnchorElement && active.getAttribute('href')?.startsWith('#') === true;
    });

    // Browse: the catalogue is reachable from the home page by keyboard.
    await page.goto(`${STOREFRONT_URL}/`, { waitUntil: 'domcontentloaded' });
    steps.push(
      await hop(page, '/', '/catalog', 'a[href="/catalog"]', (url) => url.includes('/catalog')),
    );

    // Browse → PDP, from a real category page: a product link, activated with
    // the keyboard, lands on the product.
    await page.goto(`${STOREFRONT_URL}${categoryUrl}`, { waitUntil: 'domcontentloaded' });
    steps.push(
      await hop(page, categoryUrl, '/p/[slug]', 'a[href^="/p/"]', (url) => url.includes('/p/')),
    );

    // PDP → cart: the commercial control carries an accessible name and the
    // keyboard can operate it. Where the platform quotes no price the page
    // offers a quote instead, and either satisfies the step.
    const commercial = `button:not([disabled])`;
    const reached = await tabUntilNamed(page, commercial, [
      t('product.addToCart'),
      t('product.requestQuote'),
    ]);
    steps.push({
      from: '/p/[slug]',
      to: '/cart',
      reached,
      detail: reached
        ? ''
        : `no enabled control named "${t('product.addToCart')}" or "${t('product.requestQuote')}" ` +
          'was reachable by Tab within 120 stops',
    });
    if (reached) await page.keyboard.press('Enter');

    // Cart → checkout.
    await page.goto(`${STOREFRONT_URL}/cart`, { waitUntil: 'domcontentloaded' });
    steps.push(
      await hop(page, '/cart', '/checkout', 'a[href^="/checkout"]', (url) =>
        url.includes('/checkout'),
      ),
    );

    return { steps, skipLink: { present, focusable } };
  } finally {
    await context.close();
  }
}

async function hop(
  page: Page,
  from: string,
  to: string,
  selector: string,
  arrived: (url: string) => boolean,
): Promise<KeyboardStep> {
  if (!(await tabUntil(page, selector))) {
    return {
      from,
      to,
      reached: false,
      detail: `no element matching \`${selector}\` was reachable by Tab within 120 stops`,
    };
  }
  await page.keyboard.press('Enter');
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  const url = page.url();
  return {
    from,
    to,
    reached: arrived(url),
    detail: arrived(url) ? '' : `Enter on the focused control led to ${url}`,
  };
}

/** Tab until the focused element matches and its accessible name is one of these. */
async function tabUntilNamed(
  page: Page,
  selector: string,
  names: readonly string[],
  limit = 120,
): Promise<boolean> {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const matched = await page.evaluate(
      ({ candidate, wanted }) => {
        const active = document.activeElement;
        if (active === null || !active.matches(candidate)) return false;
        const label = (
          active.getAttribute('aria-label') ??
          active.textContent ??
          ''
        )
          .replace(/\s+/gu, ' ')
          .trim()
          .toLowerCase();
        return wanted.some((one) => label.includes(one.toLowerCase()));
      },
      { candidate: selector, wanted: [...names] },
    );
    if (matched) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function report(lines: readonly string[]): void {
  mkdirSync(dirname(FINDINGS_FILE), { recursive: true });
  writeFileSync(FINDINGS_FILE, lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8');
}

function refuse(kind: string, message: string): never {
  report([`refusal ${kind}: ${message}`]);
  console.error(`${PREFIX} ${message}; refusing to report a vacuous pass`);
  throw new Error(`${PREFIX} refusal ${kind}`);
}

test('the storefront serves what it declares, and meets the accessibility floor', async ({
  browser,
}) => {
  test.setTimeout(15 * 60 * 1000);

  const declarations = await loadDeclarations();
  const manifest = loadRouteManifest();
  const fixtures = loadFixtures();
  const plan = buildConformancePlan({ appRoot: APP_ROOT, declarations, manifest, fixtures });

  const planned = planRefusal(plan);
  if (planned !== null) refuse(planned.kind, planned.message);
  if (fixtures === null) {
    refuse(
      'no-subject',
      'no fixture manifest was written. `scripts/conformance/seed-storefront-fixtures.ts` is what ' +
        'produces it, and without it every dynamic route type has no subject',
    );
  }

  const locale = fixtures.channel.language;
  const currency = fixtures.channel.currency;

  const findings: ConformanceFinding[] = [];
  const axeRuns: AxeRun[] = [];
  const motion: ReducedMotionObservation[] = [];
  const reported: ReportedViolation[] = [];
  let fetched = 0;
  let ok = 0;

  for (const page of plan.pages) {
    const served = await fetchPage(page, currency, locale);
    fetched += 1;
    if (served.status === 200) ok += 1;
    findings.push(...assertServedPage(served));
    // An error page is not a subject for an accessibility assertion either, so
    // the browser half is skipped for it — and `short-fetch` / `no-axe-rules`
    // are computed over the pages that were actually inspected.
    if (served.status !== 200) continue;
    const inspected = await inspectInBrowser(browser, page, locale);
    axeRuns.push(inspected.axe);
    motion.push(inspected.motion);
  }

  const runtime = runRefusal({ planned: plan.pages.length, fetched, ok, axeRuns });
  if (runtime !== null) refuse(runtime.kind, runtime.message);

  const axe = classifyAxeRuns(axeRuns, KNOWN_ACCESSIBILITY_VIOLATIONS);
  findings.push(...axe.findings);
  reported.push(...axe.reported);
  findings.push(...classifyReducedMotion(motion));

  const categoryPage = plan.pages.find((one) => one.subject?.kind === 'category');
  const traversal = await traversePrimaryPath(browser, locale, categoryPage?.url ?? '/catalog');
  findings.push(...classifyKeyboardTraversal(traversal.steps, traversal.skipLink));

  // §4.4 — the three facts that bound the verdict, printed rather than left to
  // a reader who does not know them.
  const modules = await composedModules();
  console.log(
    `${PREFIX} read: pages=${plan.pages.length}/${plan.declarationCount} ` +
      `channel=${fixtures.channel.code} language=${locale} ` +
      `modules=${modules === null ? 'unknown' : `${modules.present}/${modules.total}`} ` +
      `assertions=${plan.pages.length} axe-rules=${axeRuns[0]?.rulesRun ?? 0} ` +
      `sources=next-manifest:${plan.coverage.covered}/${plan.coverage.expected}`,
  );
  console.log(
    `${PREFIX} axe-violations=${axe.total} failing=${axe.findings.length} ` +
      `reported=${reported.length} ledgered=${KNOWN_ACCESSIBILITY_VIOLATIONS.length} ` +
      `excluded=${plan.excluded.length} findings=${findings.length}`,
  );
  for (const one of plan.excluded) {
    console.log(`${PREFIX} excluded ${one.route}: ${one.reason}`);
  }
  for (const one of reported) {
    console.log(`${PREFIX} reported ${one.route} ${one.rule} (${one.impact}) ${one.target}`);
  }
  console.log(`\n${WHAT_A_GREEN_DOES_NOT_MEAN}\n`);

  report(findings.map((finding) => `${finding.kind} [${finding.route}]: ${finding.detail}`));
  for (const finding of findings) {
    console.error(`${PREFIX} ${finding.kind} [${finding.route}]: ${finding.detail}`);
  }
  expect(findings.map((finding) => `${finding.kind} [${finding.route}]`)).toEqual([]);
});

/** Every axe node target, flattened — exported so the report and the ledger agree. */
export { targetOf };
