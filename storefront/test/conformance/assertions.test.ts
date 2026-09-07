import { describe, expect, it } from 'vitest';

import {
  assertAbsentPage,
  assertServedPage,
  canonicalOf,
  canonicalPathOf,
  classifyAxeRuns,
  classifyKeyboardTraversal,
  classifyReducedMotion,
  countHeadings,
  firstHeadingText,
  metaDescriptionOf,
  runRefusal,
  structuredDataOf,
  describeElement,
  selectorOf,
  titleOf,
  visibleText,
  WHAT_A_GREEN_DOES_NOT_MEAN,
  type AxeRun,
  type KnownViolation,
  type ServedPage,
} from './assertions';

/**
 * One red proof per finding this job claims to make, and one per refusal
 * (`contracts/accessibility-floor.md` §4.5; issue #130).
 *
 * Every fixture is **served bytes** or an **axe result** — the two observations
 * a real run collects — never a pre-classified record. The whole of the
 * analysis is between those bytes and a finding, so a fixture entering below it
 * would prove the reporter and leave the reading unproven, which is the shape
 * the estate keeps paying for.
 */

/** A page that answers every assertion, so each red below is one edit from it. */
function servedPage(overrides: Partial<ServedPage> = {}): ServedPage {
  const html = [
    '<!DOCTYPE html><html lang="en"><head>',
    '<title>Pump 01 — Shop</title>',
    '<meta name="description" content="A pump."/>',
    '<link rel="canonical" href="https://shop.example.com/p/pump-01"/>',
    '<script type="application/ld+json">',
    '{"@context":"https://schema.org","@type":"Product","name":"Pump 01",',
    '"offers":{"@type":"Offer","price":"1234.56","priceCurrency":"PLN"}}',
    '</script>',
    '</head><body>',
    '<h1>Pump 01</h1><p>1 234,56 zł</p>',
    '<a href="/p/pump-02">Pump 02</a>',
    '</body></html>',
  ].join('');
  return {
    route: '/p/[slug]',
    url: '/p/pump-01',
    status: 200,
    html,
    declaredJsonLd: ['Product', 'Offer'],
    domainContent: {
      heading: 'Pump 01',
      priceOrQuote: { currencyAffix: 'zł', quotePhrase: 'Request a quote' },
    },
    expectedCanonical: '/p/pump-01',
    ...overrides,
  };
}

function kinds(page: ServedPage): readonly string[] {
  return assertServedPage(page).map((finding) => finding.kind);
}

describe('reading the served bytes', () => {
  it('reads a title, a meta description and a canonical whatever the attribute order', () => {
    const html =
      '<title>T</title><meta content="D" name="description"/><link href="/x" rel="canonical"/>';
    expect(titleOf(html)).toBe('T');
    expect(metaDescriptionOf(html)).toBe('D');
    expect(canonicalOf(html)).toBe('/x');
  });

  it('counts `<h1>` and not `<h10>`-shaped nonsense or a mention in text', () => {
    expect(countHeadings('<h1>a</h1><h1 class="b">b</h1>', 1)).toBe(2);
    expect(countHeadings('<p>write an h1 here</p>', 1)).toBe(0);
  });

  it('reads the first heading text through the markup inside it', () => {
    expect(firstHeadingText('<h1><span>Pump</span> 01</h1>')).toBe('Pump 01');
  });

  it('collects nested and `@graph` schema.org types, and the escaping the emitter applies', () => {
    // `JsonLd` escapes `<` as `\u003c`; a crawler's parser restores it, and so
    // must this one, or a legitimate value would read as a broken block.
    const html =
      '<script type="application/ld+json">' +
      '{"@graph":[{"@type":"BreadcrumbList","name":"a \\u003cb\\u003e"},' +
      '{"@type":"Product","offers":{"@type":"Offer"}}]}</script>';
    expect(structuredDataOf(html)).toEqual({
      types: ['BreadcrumbList', 'Offer', 'Product'],
      unreadable: 0,
    });
  });

  it('counts a block that will not parse rather than reading it as no types', () => {
    const html = '<script type="application/ld+json">{"@type":}</script>';
    expect(structuredDataOf(html)).toEqual({ types: [], unreadable: 1 });
  });

  it('takes script and style content out of the visible text', () => {
    const html = '<style>.a{}</style><script>var x = "Pump 99";</script><p>Pump&nbsp;01</p>';
    expect(visibleText(html)).toBe('Pump 01');
    expect(visibleText(html)).not.toContain('Pump 99');
  });
});

describe('the served-HTML findings', () => {
  it('passes a page that answers every assertion', () => {
    expect(kinds(servedPage())).toEqual([]);
  });

  it('non-200 — and makes no further assertion about that page', () => {
    const findings = assertServedPage(servedPage({ status: 404, html: '' }));
    expect(findings.map((one) => one.kind)).toEqual(['non-200']);
  });

  it('missing-title', () => {
    const page = servedPage();
    expect(kinds({ ...page, html: page.html.replace(/<title>[\s\S]*?<\/title>/u, '') })).toContain(
      'missing-title',
    );
  });

  it('missing-meta-description', () => {
    const page = servedPage();
    expect(kinds({ ...page, html: page.html.replace(/<meta[^>]*>/u, '') })).toContain(
      'missing-meta-description',
    );
  });

  it('missing-canonical', () => {
    const page = servedPage();
    expect(kinds({ ...page, html: page.html.replace(/<link[^>]*>/u, '') })).toContain(
      'missing-canonical',
    );
  });

  it('canonical-mismatch — a canonical that is a real URL and not this page\'s', () => {
    const page = servedPage();
    expect(
      kinds({ ...page, html: page.html.replace('/p/pump-01"', '/p/pump-02"') }),
    ).toContain('canonical-mismatch');
  });

  it('missing-h1 and multiple-h1', () => {
    const page = servedPage();
    expect(kinds({ ...page, html: page.html.replace(/<h1>[\s\S]*?<\/h1>/u, '') })).toContain(
      'missing-h1',
    );
    expect(
      kinds({ ...page, html: page.html.replace('<h1>Pump 01</h1>', '<h1>a</h1><h1>Pump 01</h1>') }),
    ).toContain('multiple-h1');
  });

  it('missing-structured-data names the declared types the page did not emit', () => {
    const page = servedPage();
    const findings = assertServedPage({
      ...page,
      html: page.html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/u, ''),
    });
    expect(findings.map((one) => one.kind)).toContain('missing-structured-data');
    expect(findings.find((one) => one.kind === 'missing-structured-data')?.detail).toContain(
      'Product, Offer',
    );
  });

  it('unreadable-structured-data', () => {
    const page = servedPage();
    expect(
      kinds({
        ...page,
        html: page.html.replace(
          /<script type="application\/ld\+json">[\s\S]*?<\/script>/u,
          '<script type="application/ld+json">{oops}</script>',
        ),
      }),
    ).toContain('unreadable-structured-data');
  });

  it('missing-domain-content — the heading is the loading state and not the product', () => {
    const page = servedPage();
    expect(
      kinds({ ...page, html: page.html.replace('<h1>Pump 01</h1>', '<h1>Loading…</h1>') }),
    ).toContain('missing-domain-content');
  });

  it('missing-domain-content — neither a price nor a quote call to action', () => {
    const page = servedPage();
    expect(kinds({ ...page, html: page.html.replace('1 234,56 zł', '') })).toContain(
      'missing-domain-content',
    );
  });

  it('is satisfied by the quote call to action where the platform quotes no price', () => {
    const page = servedPage();
    expect(
      kinds({ ...page, html: page.html.replace('1 234,56 zł', 'Request a quote') }),
    ).toEqual([]);
  });

  it('missing-domain-content — a category page that links no product', () => {
    const page = servedPage({
      route: '/c/[slug]',
      url: '/c/pumps',
      declaredJsonLd: [],
      domainContent: { heading: 'Pump 01', linksProducts: true },
    });
    expect(kinds({ ...page, html: page.html.replace(/<a[^>]*>[\s\S]*?<\/a>/u, '') })).toContain(
      'missing-domain-content',
    );
    expect(kinds(page)).toEqual([]);
  });

  it('does not read a product URL inside a script as a rendered catalogue', () => {
    // The discrimination that makes the category assertion worth making: a
    // client-rendered grid ships its links in a payload, not in the document.
    const page = servedPage({
      route: '/c/[slug]',
      url: '/c/pumps',
      declaredJsonLd: [],
      domainContent: { heading: 'Pumps', linksProducts: true },
      html: '<h1>Pumps</h1><script>var a = "href=\\"/p/pump-02\\"";</script>',
      expectedCanonical: '/c/pumps',
    });
    const findings = assertServedPage(page);
    expect(findings.map((one) => one.kind)).toContain('missing-domain-content');
  });
});

describe('the accessibility verdict', () => {
  const run = (overrides: Partial<AxeRun> = {}): AxeRun => ({
    route: '/p/[slug]',
    rulesRun: 84,
    violations: [
      {
        id: 'color-contrast',
        impact: 'serious',
        help: 'Elements must have sufficient colour contrast',
        nodes: [{ target: ['.price'], html: '<span class="price muted">12,00 zl</span>' }],
      },
    ],
    ...overrides,
  });

  const ledgered: KnownViolation = {
    route: '/p/[slug]',
    rule: 'color-contrast',
    target: 'span.muted.price',
    impact: 'serious',
    reason: 'the muted price token against the card surface',
    repairedBy: 'the token being darkened',
  };

  it('fails a `serious` violation the ledger does not name', () => {
    const verdict = classifyAxeRuns([run()], []);
    expect(verdict.findings.map((one) => one.kind)).toEqual(['accessibility-violation']);
    expect(verdict.total).toBe(1);
  });

  it('accepts the same violation once it is ledgered', () => {
    expect(classifyAxeRuns([run()], [ledgered]).findings).toEqual([]);
  });

  it('reports `moderate` and `minor` without failing (FR-042)', () => {
    const verdict = classifyAxeRuns(
      [
        run({
          violations: [
            { id: 'region', impact: 'moderate', nodes: [{ target: ['.x'], html: '<div class="x">' }] },
          ],
        }),
      ],
      [],
    );
    expect(verdict.findings).toEqual([]);
    expect(verdict.reported).toEqual([
      { route: '/p/[slug]', rule: 'region', impact: 'moderate', target: 'div.x' },
    ]);
  });

  it('fails a ledger entry the run no longer finds — this is how a repair proves itself', () => {
    const verdict = classifyAxeRuns([run({ violations: [] })], [ledgered]);
    expect(verdict.findings.map((one) => one.kind)).toEqual(['stale-accessibility-ledger-entry']);
  });

  it('does not call an entry stale for a page this run never measured', () => {
    const verdict = classifyAxeRuns([run({ route: '/catalog', violations: [] })], [ledgered]);
    expect(verdict.findings).toEqual([]);
  });

  it('keys on the route pattern and the target, so two elements are two entries', () => {
    const verdict = classifyAxeRuns(
      [
        run({
          violations: [
            {
              ...run().violations[0]!,
              nodes: [
                { target: ['.price'], html: '<span class="price muted">12,00 zl</span>' },
                { target: ['.sku'], html: '<span class="sku">SKU-1</span>' },
              ],
            },
          ],
        }),
      ],
      [ledgered],
    );
    expect(verdict.findings.map((one) => one.detail)).toEqual([
      expect.stringContaining('span.sku') as unknown as string,
    ]);
  });

  it('flattens a shadow-root path the way axe nests it, for the report', () => {
    expect(selectorOf([['#host', '.inner']])).toBe('#host .inner');
    expect(selectorOf(['.a'])).toBe('.a');
  });

  it('keys on the element and not on axe\'s path, which is not stable', () => {
    // Measured on this storefront: two runs against one build described the
    // same element as `label:nth-child(2) > .text-subtle.font-mono.text-[11px]`
    // and as `.cursor-pointer:nth-child(2) > .text-subtle.text-[11px].font-mono`.
    // Sorting the class tokens is what makes those one key.
    expect(describeElement('<span class="font-mono text-[11px] text-subtle">40</span>')).toBe(
      describeElement('<span class="text-subtle font-mono text-[11px]">41</span>'),
    );
    expect(describeElement('<input type="search" aria-label="Szukaj">')).toBe(
      'input[type="search"]',
    );
    expect(describeElement('<small>tagline</small>')).toBe('small');
  });

  it('numbers a second element with the same signature rather than merging them', () => {
    const verdict = classifyAxeRuns(
      [
        run({
          violations: [
            {
              id: 'color-contrast',
              impact: 'serious',
              nodes: [
                { target: ['.a'], html: '<span class="muted">a</span>' },
                { target: ['.b'], html: '<span class="muted">b</span>' },
              ],
            },
          ],
        }),
      ],
      [],
    );
    expect(verdict.findings.map((one) => one.detail.includes('span.muted#2'))).toEqual([
      false,
      true,
    ]);
  });
});

describe('the keyboard traversal', () => {
  it('fails a step of the primary path the keyboard did not reach', () => {
    const findings = classifyKeyboardTraversal(
      [{ from: '/c/[slug]', to: '/p/[slug]', reached: false, detail: 'no focusable product link' }],
      { present: true, focusable: true },
    );
    expect(findings.map((one) => one.kind)).toEqual(['unreachable-keyboard-step']);
  });

  it('fails a document with no skip link, and one whose skip link the first Tab misses', () => {
    expect(
      classifyKeyboardTraversal([], { present: false, focusable: false }).map((one) => one.kind),
    ).toEqual(['missing-skip-link']);
    expect(
      classifyKeyboardTraversal([], { present: true, focusable: false }).map((one) => one.kind),
    ).toEqual(['missing-skip-link']);
    expect(classifyKeyboardTraversal([], { present: true, focusable: true })).toEqual([]);
  });
});

describe('the status line of a URL with no subject', () => {
  /** The whole assertion: `specs/108-storefront-response-status/` FR-009. */
  const probe = { route: '/p/[slug]', url: '/p/endora-conformance-absent-6f2a91c4' };

  it('passes a 404', () => {
    expect(assertAbsentPage({ ...probe, status: 404 })).toEqual([]);
  });

  it('reports a 200 — the defect this feature exists for', () => {
    const [finding] = assertAbsentPage({ ...probe, status: 200 });
    expect(finding?.kind).toBe('absent-page-not-404');
    expect(finding?.route).toBe('/p/[slug]');
    expect(finding?.detail).toContain(probe.url);
    // The sentence has to name the consequence, because the number alone reads
    // as a cosmetic disagreement: it is the storefront telling every crawler,
    // link checker and monitor that a page that is not there is there.
    expect(finding?.detail).toContain('Soft 404');
  });

  it('reports a redirect apart from a 200 — a different defect, a different repair', () => {
    const [finding] = assertAbsentPage({ ...probe, status: 308 });
    expect(finding?.kind).toBe('absent-page-not-404');
    expect(finding?.detail).toContain('absent, not moved');
  });

  it('reports a fetch that never landed rather than reading it as a 404', () => {
    // Status 0 is "no status was observed". Read as anything else it would be
    // the one shape this probe must never take: a green from a request that
    // measured nothing.
    const [finding] = assertAbsentPage({ ...probe, status: 0 });
    expect(finding?.kind).toBe('absent-page-not-404');
    expect(finding?.detail).toContain('could not be fetched');
  });

  it('reports a 500 as itself', () => {
    const [finding] = assertAbsentPage({ ...probe, status: 500 });
    expect(finding?.detail).toContain('HTTP 500');
  });
});

describe('the refusals', () => {
  const axeRuns = [{ route: '/', rulesRun: 84, violations: [] }];
  /** A run whose status half did what it planned, so each red below is one edit from it. */
  const absent = { absentPlanned: 3, absentIssued: 3 };

  it('refuses a run that fetched fewer pages than it planned', () => {
    expect(runRefusal({ planned: 9, fetched: 8, ok: 8, axeRuns, ...absent })?.kind).toBe(
      'short-fetch',
    );
  });

  it('refuses a run in which no page answered 200 — nothing was measured', () => {
    expect(runRefusal({ planned: 9, fetched: 9, ok: 0, axeRuns, ...absent })?.kind).toBe(
      'no-page-fetched',
    );
  });

  it('refuses a run that planned absent probes and issued none', () => {
    // `response-status.md` §4.4. The status half is invisible to every other
    // assertion here — all of them are made about pages that answered 200 — so
    // a run that skipped it reports a clean sweep having measured nothing about
    // the thing this feature added.
    const refusal = runRefusal({
      planned: 9,
      fetched: 9,
      ok: 9,
      axeRuns,
      absentPlanned: 4,
      absentIssued: 0,
    });
    expect(refusal?.kind).toBe('no-absent-probe-issued');
    expect(refusal?.message).toContain('4');
  });

  it('does not refuse a run that planned no absent probe at all', () => {
    // A tree with no dynamic route type owes none, and the refusal is a
    // conditional rather than a universal for that reason.
    expect(
      runRefusal({ planned: 1, fetched: 1, ok: 1, axeRuns, absentPlanned: 0, absentIssued: 0 }),
    ).toBeNull();
  });

  it('refuses a page on which axe evaluated no rule at all', () => {
    const refusal = runRefusal({
      planned: 1,
      fetched: 1,
      ok: 1,
      axeRuns: [{ route: '/catalog', rulesRun: 0, violations: [] }],
      ...absent,
    });
    expect(refusal?.kind).toBe('no-axe-rules');
    expect(refusal?.message).toContain('/catalog');
  });

  it('passes a run that fetched everything it planned and ran rules on every page', () => {
    expect(runRefusal({ planned: 1, fetched: 1, ok: 1, axeRuns, ...absent })).toBeNull();
  });
});

describe('what a green does not mean', () => {
  it('names the three bounds and the rule no automated pass decides', () => {
    expect(WHAT_A_GREEN_DOES_NOT_MEAN).toContain('one sales channel');
    expect(WHAT_A_GREEN_DOES_NOT_MEAN).toContain('one language');
    expect(WHAT_A_GREEN_DOES_NOT_MEAN).toContain('colour is never the only carrier of meaning');
  });
});

describe('the canonical is compared as a path', () => {
  it('accepts an absolute canonical whose path is this page\'s', () => {
    expect(canonicalPathOf('https://shop.example.com/p/pump-01')).toBe('/p/pump-01');
  });

  it('refuses one that merely ends with it — a locale prefix is a different page', () => {
    const page = servedPage();
    expect(
      kinds({ ...page, html: page.html.replace('/p/pump-01"', '/en/p/pump-01"') }),
    ).toContain('canonical-mismatch');
  });
});

describe('prefers-reduced-motion', () => {
  it('fails an element still running an animation while the preference is set', () => {
    const findings = classifyReducedMotion([
      { route: '/', mediaQueryMatches: true, animating: ['.spinner'] },
    ]);
    expect(findings.map((one) => one.kind)).toEqual(['motion-under-reduced-motion']);
  });

  it('fails an emulation that did not reach the document, rather than reporting it clean', () => {
    const findings = classifyReducedMotion([
      { route: '/', mediaQueryMatches: false, animating: [] },
    ]);
    expect(findings[0]?.detail).toContain('the emulation, not the page');
  });

  it('says nothing about a transition — the rule is about animation', () => {
    expect(classifyReducedMotion([{ route: '/', mediaQueryMatches: true, animating: [] }])).toEqual(
      [],
    );
  });
});
