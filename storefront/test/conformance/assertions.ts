/**
 * The conformance job's judgement, separated from its plumbing
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-030…FR-043;
 * `contracts/accessibility-floor.md` §2 and §4).
 *
 * `scripts/conformance-storefront.sh` boots a seeded platform and a built
 * storefront and collects two observations per representative page: the bytes a
 * plain `fetch` received, and the result of an axe run in a real browser.
 * Everything below turns those two into findings, and it touches neither the
 * network nor a browser — which is what lets `assertions.test.ts` drive every
 * finding this job claims to make over fixture text. A gate that has never been
 * red is a gate nobody has tested.
 *
 * ## The `fetch` is the no-JavaScript condition, and no browser establishes it
 *
 * FR-030 and `contracts/accessibility-floor.md` §4.2: a plain `fetch` executes
 * no JavaScript, so what comes back **is** what a crawler receives. A headless
 * browser with scripting disabled is a weaker instrument that costs more, and
 * none is introduced for this half. The browser enters only for §2's three
 * style-dependent rules, which are undecidable from markup.
 *
 * ## What a green does not mean
 *
 * `WHAT_A_GREEN_DOES_NOT_MEAN` below is printed on every run, red or green.
 * `contracts/accessibility-floor.md` §3 requires it in the job's own output
 * rather than only in a contract nobody reads at 2 a.m.: automated
 * accessibility testing covers a minority of WCAG, one of the floor's rules is
 * decided by no automated rule at all, and the sweep is one channel, one
 * language and one module set.
 */

// ---------------------------------------------------------------------------
// What the job observed
// ---------------------------------------------------------------------------

/** One representative page, as a plain `fetch` received it. */
export interface ServedPage {
  /** The route pattern — the finding's subject and the ledger's key. */
  readonly route: string;
  /** The URL fetched. */
  readonly url: string;
  readonly status: number;
  readonly html: string;
  /** The schema.org types the route's own `seo.ts` declares it emits. */
  readonly declaredJsonLd: readonly string[];
  /** What FR-032 expects this page to be about, or `null` where it expects nothing. */
  readonly domainContent: DomainContentExpectation | null;
  /** The canonical path the route declares for this URL. */
  readonly expectedCanonical: string;
}

/**
 * FR-032's expectation for the two route types that carry it.
 *
 * Every string in it is computed by the runner from the storefront's **own**
 * helpers — `formatMoney` for the currency affix, the message catalogue for the
 * quote phrase — so this file holds no copy of either and a change to the way
 * the storefront renders money reaches the assertion by being read.
 */
export interface DomainContentExpectation {
  /** The `<h1>` the page is about: the seeded product's or category's name. */
  readonly heading: string;
  /**
   * The commercial answer a product page must give: the currency's own affix as
   * `Intl` renders it, and the phrase the storefront uses when it has no price.
   * Either satisfies FR-032's "price or quote CTA"; neither is a finding.
   */
  readonly priceOrQuote?: { readonly currencyAffix: string; readonly quotePhrase: string };
  /** A category page must link at least one product. */
  readonly linksProducts?: boolean;
}

/** One axe rule result, in the shape `@axe-core/playwright` returns. */
export interface AxeRuleResult {
  readonly id: string;
  readonly impact?: string | null;
  readonly help?: string;
  readonly nodes: readonly { readonly target: readonly (string | readonly string[])[] }[];
}

/** One page's axe run. */
export interface AxeRun {
  readonly route: string;
  readonly violations: readonly AxeRuleResult[];
  /** Every rule axe actually evaluated — violations, passes, incomplete and inapplicable. */
  readonly rulesRun: number;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type ConformanceFindingKind =
  | 'non-200'
  | 'missing-title'
  | 'missing-meta-description'
  | 'missing-canonical'
  | 'canonical-mismatch'
  | 'missing-h1'
  | 'multiple-h1'
  | 'missing-structured-data'
  | 'unreadable-structured-data'
  | 'missing-domain-content'
  | 'accessibility-violation'
  | 'stale-accessibility-ledger-entry'
  | 'unreachable-keyboard-step'
  | 'missing-skip-link';

export interface ConformanceFinding {
  readonly kind: ConformanceFindingKind;
  /** The route pattern the finding is about. */
  readonly route: string;
  readonly detail: string;
}

/** A `moderate` or `minor` axe violation: reported, never failing (FR-042). */
export interface ReportedViolation {
  readonly route: string;
  readonly rule: string;
  readonly impact: string;
  readonly target: string;
}

// ---------------------------------------------------------------------------
// Reading the served bytes
// ---------------------------------------------------------------------------

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

/** Decode the handful of entities React emits, and normalise NBSP to a space. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/gu, (match) => ENTITIES[match] ?? match)
    .replace(/ /gu, ' ');
}

function collapse(text: string): string {
  return decodeEntities(text).replace(/\s+/gu, ' ').trim();
}

/** How many `<hN>` elements the document carries. */
export function countHeadings(html: string, level: number): number {
  return html.match(new RegExp(`<h${level}(?=[\\s/>])`, 'giu'))?.length ?? 0;
}

/** The text of the first `<h1>`, with its markup stripped. */
export function firstHeadingText(html: string): string | null {
  const match = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/iu.exec(html);
  if (match === null) return null;
  return collapse((match[1] as string).replace(/<[^>]*>/gu, ' '));
}

export function titleOf(html: string): string | null {
  const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/iu.exec(html);
  return match === null ? null : collapse(match[1] as string);
}

/** A tag's attribute, whichever order the renderer wrote the attributes in. */
function attributeOf(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'iu').exec(tag);
  return match === null ? null : decodeEntities(match[1] as string);
}

export function metaDescriptionOf(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    if (attributeOf(tag, 'name')?.toLowerCase() !== 'description') continue;
    const content = attributeOf(tag, 'content');
    if (content !== null && content.trim().length > 0) return content.trim();
  }
  return null;
}

export function canonicalOf(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    if (attributeOf(tag, 'rel')?.toLowerCase() !== 'canonical') continue;
    const href = attributeOf(tag, 'href');
    if (href !== null && href.trim().length > 0) return href.trim();
  }
  return null;
}

/** Every schema.org type the document's JSON-LD carries, and what would not parse. */
export function structuredDataOf(html: string): {
  readonly types: readonly string[];
  readonly unreadable: number;
} {
  const types = new Set<string>();
  let unreadable = 0;
  const blocks = html.matchAll(
    /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/giu,
  );
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1] as string);
    } catch {
      // A finding, never a skip (issue #113): a block a crawler cannot parse
      // is a block a crawler ignores, and reading it as "no types here" is the
      // direction that agrees with the defect.
      unreadable += 1;
      continue;
    }
    collectTypes(parsed, types);
  }
  return { types: [...types].sort(), unreadable };
}

function collectTypes(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const element of value) collectTypes(element, into);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const declared = record['@type'];
  if (typeof declared === 'string') into.add(declared);
  if (Array.isArray(declared)) {
    for (const one of declared) if (typeof one === 'string') into.add(one);
  }
  for (const nested of Object.values(record)) collectTypes(nested, into);
}

/** The document's text, with every script and style element removed first. */
export function visibleText(html: string): string {
  return collapse(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
      .replace(/<[^>]*>/gu, ' '),
  );
}

/**
 * Whether the document links at least one product detail page.
 *
 * Scripts are removed first, deliberately: a client-rendered grid ships its
 * links inside a payload, and a page whose catalogue only exists there is
 * exactly the page a crawler sees empty.
 */
export function linksAProduct(html: string): boolean {
  return /href="\/p\/[^"#]+"/iu.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' '));
}

/**
 * The path a canonical names, whether it was written absolute or relative.
 *
 * Compared as a path rather than by suffix: `https://shop/en/p/pump-01` ends
 * with `/p/pump-01` and is a different page.
 */
export function canonicalPathOf(canonical: string): string {
  try {
    return new URL(canonical).pathname;
  } catch {
    return canonical;
  }
}

// ---------------------------------------------------------------------------
// FR-031 / FR-032 — the served HTML
// ---------------------------------------------------------------------------

/**
 * What the bytes a crawler received say about one page.
 *
 * A non-200 is a **finding**, and the assertions below it are not made. That is
 * a deliberate departure from `contracts/accessibility-floor.md` §4.5, which
 * lists it as a refusal, and it takes `scripts/boot-gate.sh`'s ruling on the
 * same shape: *"a container that never booted is a finding and exits 1 — it is
 * the loudest answer this gate can give, and calling it 'nothing was read'
 * would file the worst outcome under the mildest verdict"*. The contract's
 * reasoning — an assertion over an error page is an assertion about nothing —
 * is kept in full by making no further assertion about that page; what changes
 * is only which verdict a broken route earns. `everyPageFailed` below is the
 * state that genuinely measured nothing, and that one is a refusal.
 */
export function assertServedPage(page: ServedPage): readonly ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const at = (kind: ConformanceFindingKind, detail: string): void => {
    findings.push({ kind, route: page.route, detail });
  };

  if (page.status !== 200) {
    at(
      'non-200',
      `${page.url} answered HTTP ${page.status}. This route type declares itself indexable, so ` +
        'a crawler fetching it is being told the page is there and receiving an error; nothing ' +
        'below this line was measured for it',
    );
    return findings;
  }

  if (titleOf(page.html) === null) at('missing-title', `${page.url} serves no \`<title>\``);
  if (metaDescriptionOf(page.html) === null) {
    at('missing-meta-description', `${page.url} serves no \`<meta name="description">\``);
  }

  const canonical = canonicalOf(page.html);
  if (canonical === null) {
    at('missing-canonical', `${page.url} serves no \`<link rel="canonical">\``);
  } else if (canonicalPathOf(canonical) !== page.expectedCanonical) {
    at(
      'canonical-mismatch',
      `${page.url} serves the canonical \`${canonical}\`, and its own declaration says this URL ` +
        `is \`${page.expectedCanonical}\`. A canonical pointing somewhere else consolidates this ` +
        'page\'s ranking signals onto another URL',
    );
  }

  const headings = countHeadings(page.html, 1);
  if (headings === 0) {
    at('missing-h1', `${page.url} serves no \`<h1>\``);
  } else if (headings > 1) {
    at(
      'multiple-h1',
      `${page.url} serves ${headings} \`<h1>\` elements. One document, one first-level heading`,
    );
  }

  const structured = structuredDataOf(page.html);
  if (structured.unreadable > 0) {
    at(
      'unreadable-structured-data',
      `${page.url} carries ${structured.unreadable} \`application/ld+json\` block(s) that will ` +
        'not parse. A crawler discards them silently, so the page emits less than it appears to',
    );
  }
  const missing = page.declaredJsonLd.filter((type) => !structured.types.includes(type));
  if (missing.length > 0) {
    at(
      'missing-structured-data',
      `${page.url} declares \`${page.declaredJsonLd.join(', ')}\` in its own \`seo.ts\` and the ` +
        `served HTML carries ${structured.types.length === 0 ? 'none of them' : `\`${structured.types.join(', ')}\``}` +
        `. Missing: \`${missing.join(', ')}\``,
    );
  }

  const expectation = page.domainContent;
  if (expectation !== null) {
    const heading = firstHeadingText(page.html);
    const text = visibleText(page.html);
    if (heading === null || heading !== expectation.heading) {
      at(
        'missing-domain-content',
        `${page.url} is served for \`${expectation.heading}\` and its \`<h1>\` reads ` +
          `${heading === null ? 'nothing' : `\`${heading}\``}. The primary domain content is what ` +
          'a crawler came for, and it is what a page rendering its own loading state omits',
      );
    }
    const commercial = expectation.priceOrQuote;
    if (
      commercial !== undefined &&
      !text.includes(commercial.currencyAffix) &&
      !text.includes(commercial.quotePhrase)
    ) {
      at(
        'missing-domain-content',
        `${page.url} shows neither a price in ${commercial.currencyAffix} nor the ` +
          `"${commercial.quotePhrase}" call to action. A product page that answers neither ` +
          'question is a product page with no commercial content in it',
      );
    }
    if (expectation.linksProducts === true && !linksAProduct(page.html)) {
      at(
        'missing-domain-content',
        `${page.url} links no product detail page at all. A category page whose catalogue is ` +
          'rendered on the client is a category page a crawler sees empty',
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// FR-040…FR-043 — the accessibility pass
// ---------------------------------------------------------------------------

/**
 * One accepted violation. Keyed `(page type, axe rule id, target selector)`, as
 * `contracts/accessibility-floor.md` §5 requires.
 */
export interface KnownViolation {
  /** The route pattern, never a URL: a seeded slug is not part of the key. */
  readonly route: string;
  readonly rule: string;
  readonly target: string;
  readonly impact: string;
  /** What the element is, and why this violation stands today. */
  readonly reason: string;
  /** The change that makes this entry stale — never "when someone gets to it". */
  readonly repairedBy: string;
}

export interface AxeVerdict {
  readonly findings: readonly ConformanceFinding[];
  /** `moderate` and `minor`, reported and not failing (FR-042). */
  readonly reported: readonly ReportedViolation[];
  /** Every violation seen, ledgered or not — the run's `axe-violations=` count. */
  readonly total: number;
}

const FAILING_IMPACTS = new Set(['serious', 'critical']);

/** The `(route, rule, target)` triple, one string, for both directions. */
function keyOf(route: string, rule: string, target: string): string {
  return `${route} ${rule} ${target}`;
}

/** A node's target selector, flattened — axe nests one for a shadow root. */
export function targetOf(target: readonly (string | readonly string[])[]): string {
  return target.map((one) => (Array.isArray(one) ? one.join(' ') : String(one))).join(' ');
}

/**
 * The accessibility verdict, over the axe runs and the ledger.
 *
 * Two directions, both of them (FR-043). A `serious` or `critical` violation
 * the ledger does not name fails; a ledger entry that no longer describes a
 * violation **on a page this run actually measured** fails as stale, which is
 * how a repair proves itself. An entry over a page the run could not fetch is
 * neither — it was not measured, and calling it stale would strand it on the
 * first run in which an unrelated route broke.
 */
export function classifyAxeRuns(
  runs: readonly AxeRun[],
  ledger: readonly KnownViolation[],
): AxeVerdict {
  const findings: ConformanceFinding[] = [];
  const reported: ReportedViolation[] = [];
  const measured = new Set(runs.map((run) => run.route));
  const seen = new Set<string>();
  let total = 0;

  const accepted = new Set(ledger.map((one) => keyOf(one.route, one.rule, one.target)));

  for (const run of runs) {
    for (const violation of run.violations) {
      for (const node of violation.nodes) {
        const target = targetOf(node.target);
        const impact = violation.impact ?? 'unknown';
        total += 1;
        seen.add(keyOf(run.route, violation.id, target));
        if (!FAILING_IMPACTS.has(impact)) {
          reported.push({ route: run.route, rule: violation.id, impact, target });
          continue;
        }
        if (accepted.has(keyOf(run.route, violation.id, target))) continue;
        findings.push({
          kind: 'accessibility-violation',
          route: run.route,
          detail:
            `${violation.id} (${impact}) on \`${target}\`` +
            `${violation.help === undefined ? '' : ` — ${violation.help}`}`,
        });
      }
    }
  }

  for (const entry of ledger) {
    if (!measured.has(entry.route)) continue;
    if (seen.has(keyOf(entry.route, entry.rule, entry.target))) continue;
    findings.push({
      kind: 'stale-accessibility-ledger-entry',
      route: entry.route,
      detail:
        `\`KNOWN_ACCESSIBILITY_VIOLATIONS\` accepts ${entry.rule} on \`${entry.target}\` for ` +
        `${entry.route} and this run found no such violation. Delete the entry — its repair is ` +
        `what makes it stale, and that is how the repair proves itself. Recorded as: ${entry.repairedBy}`,
    });
  }

  return { findings, reported, total };
}

// ---------------------------------------------------------------------------
// The keyboard traversal (FR-040, `.claude/skills/ux-laws/SKILL.md` § 4)
// ---------------------------------------------------------------------------

/** One step of the primary path, and whether the keyboard alone reached it. */
export interface KeyboardStep {
  readonly from: string;
  readonly to: string;
  readonly reached: boolean;
  /** What the browser reported when it did not. */
  readonly detail: string;
}

export function classifyKeyboardTraversal(
  steps: readonly KeyboardStep[],
  skipLink: { readonly present: boolean; readonly focusable: boolean },
): readonly ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const step of steps) {
    if (step.reached) continue;
    findings.push({
      kind: 'unreachable-keyboard-step',
      route: step.from,
      detail:
        `the keyboard alone did not get from ${step.from} to ${step.to}: ${step.detail}. Every ` +
        'interactive element is keyboard reachable, in a sensible tab order — and the primary ' +
        'path is the one that has to be',
    });
  }
  if (!skipLink.present || !skipLink.focusable) {
    findings.push({
      kind: 'missing-skip-link',
      route: '/',
      detail: skipLink.present
        ? 'the skip link is in the document and the first Tab does not reach it, so a keyboard ' +
          'user still traverses the whole header on every page'
        : 'the document carries no skip link, so a keyboard user traverses the whole header ' +
          'before reaching the content on every page',
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Refusals — this job fails rather than reports
// ---------------------------------------------------------------------------

export type RunRefusalKind = 'short-fetch' | 'no-page-fetched' | 'no-axe-rules';

export interface RunRefusal {
  readonly kind: RunRefusalKind;
  readonly message: string;
}

/**
 * Why this run may not report on what it measured, or `null`.
 *
 * `contracts/accessibility-floor.md` §4.5's first, second and fourth refusals.
 * The third (classification against the built route manifest) and the fifth
 * (a route type the seed produced no subject for) are decided before anything
 * is fetched, in `plan.ts`.
 */
export function runRefusal(input: {
  readonly planned: number;
  readonly fetched: number;
  readonly ok: number;
  readonly axeRuns: readonly AxeRun[];
}): RunRefusal | null {
  if (input.fetched < input.planned) {
    return {
      kind: 'short-fetch',
      message:
        `the page set declares ${input.planned} indexable route type(s) and this run fetched ` +
        `${input.fetched}. A sweep that stopped early reports a clean run over the pages it ` +
        'reached and says nothing about the ones it did not',
    };
  }
  if (input.planned > 0 && input.ok === 0) {
    return {
      kind: 'no-page-fetched',
      message:
        'no representative page answered HTTP 200. Nothing was measured — a storefront that is ' +
        'not serving is not a storefront with no findings',
    };
  }
  const silent = input.axeRuns.filter((run) => run.rulesRun === 0).map((run) => run.route);
  if (silent.length > 0) {
    return {
      kind: 'no-axe-rules',
      message:
        `axe evaluated no rule at all on ${silent.join(', ')}. A browser that loaded nothing ` +
        'reports no violation, and that is indistinguishable from a page with none',
    };
  }
  return null;
}

/**
 * The sentence `contracts/accessibility-floor.md` §3 requires in the job's own
 * output, not only in the contract.
 */
export const WHAT_A_GREEN_DOES_NOT_MEAN = [
  'A green here means: no violation of the rules axe can decide, at `serious` or above, on the',
  'representative pages, in one sales channel, in one language, with one module set. It does not',
  'mean the storefront is accessible. Automated accessibility testing covers a minority of WCAG,',
  'and one rule of the floor — "colour is never the only carrier of meaning" — is decided by no',
  'automated rule at all and stays a design-review obligation under',
  '`.claude/skills/ux-laws/SKILL.md` § 7 item 9.',
].join('\n');
