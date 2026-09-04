import type { KnownViolation } from './assertions';

/**
 * The accessibility violations this storefront is known to carry
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-043;
 * `contracts/accessibility-floor.md` §5).
 *
 * **Two-way, and it arrives from a baseline sweep rather than empty.** Nobody
 * had run axe over this storefront before Phase 4, so an empty ledger asserted
 * on day one would have been a claim nobody measured. Every entry below was
 * produced by a real run against a booted, seeded platform, and the numbers in
 * `specs/098-storefront-ssr-seo-a11y-suite/tasks.md` T407 are what that run
 * found — not what the contract estimated.
 *
 * ## The key
 *
 * `(route pattern, axe rule id, element signature)`. The **pattern**, never the
 * URL: `/p/pump-01` is one product of a seeded catalogue and the violation is a
 * property of the product page, so keying on the URL would strand every entry
 * the first time the seed produced a different slug. And the element's own
 * signature rather than axe's CSS path, for the reason `describeElement` gives
 * in full — the path is not stable enough between two runs of one build to key
 * a two-way ledger on, measured.
 *
 * ## Both directions fail
 *
 * A `serious` or `critical` violation this file does not name fails the run.
 * An entry that no longer describes a violation **on a page the run measured**
 * fails as stale — which is how a repair proves itself, and why `repairedBy`
 * names a change rather than an intention. An entry over a page the run could
 * not fetch is neither: it was not measured, and calling it stale would strand
 * it the first time an unrelated route broke.
 *
 * `moderate` and `minor` findings are reported on every run and do not fail
 * (FR-042); they are not ledgered, because a ledger of things that cannot fail
 * is a list nobody reads.
 *
 * ## What the baseline sweep found, 2026-09-04
 *
 * **67 violations at `serious` or above, over eight representative pages, in
 * three rules** — and the number is worth less than its shape. `moderate` and
 * `minor`: **zero**.
 *
 * | rule | impact | sites |
 * | --- | --- | --- |
 * | `color-contrast` | serious | 53 |
 * | `aria-allowed-attr` | critical | 8 |
 * | `target-size` | serious | 6 |
 *
 * **Nearly all of the 53 are one token.** `text-subtle` renders `#a1a1aa`,
 * which against white is **2.56:1** where the floor is 4.5:1, and it is the
 * foreground of every facet count, every facet label, every product card's
 * price meta row, the header tagline and a listing's result count. Darkening
 * that one token retires most of this ledger in one commit. The remaining
 * contrast pair is the footer's `#71717a` on `#18181b` — 3.66:1 — which is a
 * second token on a second surface.
 *
 * The `aria-allowed-attr` eight are **one component**: the header search input
 * carries `aria-expanded` while its implicit role is `searchbox`, where that
 * attribute is not allowed, so it appears once per page. The `target-size` six
 * are the breadcrumb links, 16px tall against WCAG 2.2's 24px minimum.
 *
 * So: **67 sites, four causes, and three of the four are a one-line change.**
 * That is the finding, and it is why the ledger is a list of sites rather than
 * a list of problems — a site is what a repair has to make disappear, and a
 * repair that only *looks* right leaves its entry standing.
 *
 * None of it was visible to anything in this repository before this run:
 * `.lighthouserc.js` carried `color-contrast: 'warn'` and had had no runner
 * since `5b0bfb5dd`.
 */
export const KNOWN_ACCESSIBILITY_VIOLATIONS: readonly KnownViolation[] = [
  {
    route: '/',
    rule: 'aria-allowed-attr',
    target: 'input[type="search"]',
    impact: 'critical',
    reason: 'the header search input: it carries `aria-autocomplete` and `aria-expanded` while its implicit role is `searchbox`, where `aria-expanded` is not allowed — so the state of the suggestions popup is announced to nobody',
    repairedBy: 'SearchAutocomplete giving the input `role="combobox"` and an `aria-controls` naming its listbox, which is the role those two attributes belong to',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'div.font-mono.text-[10px].text-subtle.tracking-[0.04em].uppercase',
    impact: 'serious',
    reason: 'a product card\'s price caption ("od / szt.") — `text-subtle` on white, 2.56:1 at 10px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'div.font-mono.text-[10px].text-subtle.tracking-[0.04em].uppercase#2',
    impact: 'serious',
    reason: 'a product card\'s price caption ("od / szt.") — `text-subtle` on white, 2.56:1 at 10px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'div.font-mono.text-[10px].text-subtle.tracking-[0.04em].uppercase#3',
    impact: 'serious',
    reason: 'a product card\'s price caption ("od / szt.") — `text-subtle` on white, 2.56:1 at 10px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'div.font-mono.text-[10px].text-subtle.tracking-[0.04em].uppercase#4',
    impact: 'serious',
    reason: 'a product card\'s price caption ("od / szt.") — `text-subtle` on white, 2.56:1 at 10px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'small',
    impact: 'serious',
    reason: 'the brand tagline in the header (`<small>B2B · …</small>`) — `text-subtle` renders #a1a1aa, which is 2.56:1 on white at 10px against a 4.5:1 floor',
    repairedBy: 'the `--color-subtle` token being darkened, or this line moving off it',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'span',
    impact: 'serious',
    reason: 'the footer legal line (`© … NIP … KRS …`) — #71717a on the #18181b footer surface is 3.66:1 against 4.5:1',
    repairedBy: 'the footer muted token being lightened against its dark surface',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'span.b2b-pricing-block__suffix',
    impact: 'serious',
    reason: 'a product card\'s net/gross price suffix — `text-subtle` on white, 2.56:1 at 10px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'span.b2b-pricing-block__suffix#2',
    impact: 'serious',
    reason: 'a product card\'s net/gross price suffix — `text-subtle` on white, 2.56:1 at 10px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'span.b2b-pricing-block__suffix#3',
    impact: 'serious',
    reason: 'a product card\'s net/gross price suffix — `text-subtle` on white, 2.56:1 at 10px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/',
    rule: 'color-contrast',
    target: 'span.b2b-pricing-block__suffix#4',
    impact: 'serious',
    reason: 'a product card\'s net/gross price suffix — `text-subtle` on white, 2.56:1 at 10px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/catalog',
    rule: 'aria-allowed-attr',
    target: 'input[type="search"]',
    impact: 'critical',
    reason: 'the header search input: it carries `aria-autocomplete` and `aria-expanded` while its implicit role is `searchbox`, where `aria-expanded` is not allowed — so the state of the suggestions popup is announced to nobody',
    repairedBy: 'SearchAutocomplete giving the input `role="combobox"` and an `aria-controls` naming its listbox, which is the role those two attributes belong to',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'small',
    impact: 'serious',
    reason: 'the brand tagline in the header (`<small>B2B · …</small>`) — `text-subtle` renders #a1a1aa, which is 2.56:1 on white at 10px against a 4.5:1 floor',
    repairedBy: 'the `--color-subtle` token being darkened, or this line moving off it',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span',
    impact: 'serious',
    reason: 'the footer legal line (`© … NIP … KRS …`) — #71717a on the #18181b footer surface is 3.66:1 against 4.5:1',
    repairedBy: 'the footer muted token being lightened against its dark surface',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#2',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#3',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#4',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#5',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#6',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#7',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#8',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#9',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#10',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/catalog',
    rule: 'target-size',
    target: 'a',
    impact: 'serious',
    reason: 'a breadcrumb link: 16px tall with 18px of safe clickable space, against the 24px minimum target size WCAG 2.2 adds (2.5.8)',
    repairedBy: 'the breadcrumb trail giving its links vertical padding, or its row more line height',
  },
  {
    route: '/c/[slug]',
    rule: 'aria-allowed-attr',
    target: 'input[type="search"]',
    impact: 'critical',
    reason: 'the header search input: it carries `aria-autocomplete` and `aria-expanded` while its implicit role is `searchbox`, where `aria-expanded` is not allowed — so the state of the suggestions popup is announced to nobody',
    repairedBy: 'SearchAutocomplete giving the input `role="combobox"` and an `aria-controls` naming its listbox, which is the role those two attributes belong to',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'small',
    impact: 'serious',
    reason: 'the brand tagline in the header (`<small>B2B · …</small>`) — `text-subtle` renders #a1a1aa, which is 2.56:1 on white at 10px against a 4.5:1 floor',
    repairedBy: 'the `--color-subtle` token being darkened, or this line moving off it',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span',
    impact: 'serious',
    reason: 'the footer legal line (`© … NIP … KRS …`) — #71717a on the #18181b footer surface is 3.66:1 against 4.5:1',
    repairedBy: 'the footer muted token being lightened against its dark surface',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#2',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#3',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#4',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#5',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#6',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#7',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#8',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#9',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#10',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/c/[slug]',
    rule: 'target-size',
    target: 'a',
    impact: 'serious',
    reason: 'a breadcrumb link: 16px tall with 18px of safe clickable space, against the 24px minimum target size WCAG 2.2 adds (2.5.8)',
    repairedBy: 'the breadcrumb trail giving its links vertical padding, or its row more line height',
  },
  {
    route: '/c/[slug]',
    rule: 'target-size',
    target: 'a#2',
    impact: 'serious',
    reason: 'a breadcrumb link: 16px tall with 18px of safe clickable space, against the 24px minimum target size WCAG 2.2 adds (2.5.8)',
    repairedBy: 'the breadcrumb trail giving its links vertical padding, or its row more line height',
  },
  {
    route: '/p/[slug]',
    rule: 'aria-allowed-attr',
    target: 'input[type="search"]',
    impact: 'critical',
    reason: 'the header search input: it carries `aria-autocomplete` and `aria-expanded` while its implicit role is `searchbox`, where `aria-expanded` is not allowed — so the state of the suggestions popup is announced to nobody',
    repairedBy: 'SearchAutocomplete giving the input `role="combobox"` and an `aria-controls` naming its listbox, which is the role those two attributes belong to',
  },
  {
    route: '/p/[slug]',
    rule: 'color-contrast',
    target: 'small',
    impact: 'serious',
    reason: 'the brand tagline in the header (`<small>B2B · …</small>`) — `text-subtle` renders #a1a1aa, which is 2.56:1 on white at 10px against a 4.5:1 floor',
    repairedBy: 'the `--color-subtle` token being darkened, or this line moving off it',
  },
  {
    route: '/p/[slug]',
    rule: 'color-contrast',
    target: 'span',
    impact: 'serious',
    reason: 'the footer legal line (`© … NIP … KRS …`) — #71717a on the #18181b footer surface is 3.66:1 against 4.5:1',
    repairedBy: 'the footer muted token being lightened against its dark surface',
  },
  {
    route: '/p/[slug]',
    rule: 'color-contrast',
    target: 'span.font-normal.text-[12px].text-subtle',
    impact: 'serious',
    reason: 'the result count beside a listing heading — `text-subtle` on white, 2.56:1 at 12px',
    repairedBy: 'the `--color-subtle` token being darkened',
  },
  {
    route: '/search',
    rule: 'aria-allowed-attr',
    target: 'input[type="search"]',
    impact: 'critical',
    reason: 'the header search input: it carries `aria-autocomplete` and `aria-expanded` while its implicit role is `searchbox`, where `aria-expanded` is not allowed — so the state of the suggestions popup is announced to nobody',
    repairedBy: 'SearchAutocomplete giving the input `role="combobox"` and an `aria-controls` naming its listbox, which is the role those two attributes belong to',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'small',
    impact: 'serious',
    reason: 'the brand tagline in the header (`<small>B2B · …</small>`) — `text-subtle` renders #a1a1aa, which is 2.56:1 on white at 10px against a 4.5:1 floor',
    repairedBy: 'the `--color-subtle` token being darkened, or this line moving off it',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span',
    impact: 'serious',
    reason: 'the footer legal line (`© … NIP … KRS …`) — #71717a on the #18181b footer surface is 3.66:1 against 4.5:1',
    repairedBy: 'the footer muted token being lightened against its dark surface',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#2',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#3',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#4',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#5',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#6',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#7',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#8',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#9',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'color-contrast',
    target: 'span.font-mono.text-[11px].text-subtle#10',
    impact: 'serious',
    reason: 'a facet count in the category filter panel — `text-subtle` on white, 2.56:1 at 11px',
    repairedBy: 'the `--color-subtle` token being darkened, which retires most of this ledger at once',
  },
  {
    route: '/search',
    rule: 'target-size',
    target: 'a',
    impact: 'serious',
    reason: 'a breadcrumb link: 16px tall with 18px of safe clickable space, against the 24px minimum target size WCAG 2.2 adds (2.5.8)',
    repairedBy: 'the breadcrumb trail giving its links vertical padding, or its row more line height',
  },
  {
    route: '/kontakt',
    rule: 'aria-allowed-attr',
    target: 'input[type="search"]',
    impact: 'critical',
    reason: 'the header search input: it carries `aria-autocomplete` and `aria-expanded` while its implicit role is `searchbox`, where `aria-expanded` is not allowed — so the state of the suggestions popup is announced to nobody',
    repairedBy: 'SearchAutocomplete giving the input `role="combobox"` and an `aria-controls` naming its listbox, which is the role those two attributes belong to',
  },
  {
    route: '/kontakt',
    rule: 'color-contrast',
    target: 'small',
    impact: 'serious',
    reason: 'the brand tagline in the header (`<small>B2B · …</small>`) — `text-subtle` renders #a1a1aa, which is 2.56:1 on white at 10px against a 4.5:1 floor',
    repairedBy: 'the `--color-subtle` token being darkened, or this line moving off it',
  },
  {
    route: '/kontakt',
    rule: 'color-contrast',
    target: 'span',
    impact: 'serious',
    reason: 'the footer legal line (`© … NIP … KRS …`) — #71717a on the #18181b footer surface is 3.66:1 against 4.5:1',
    repairedBy: 'the footer muted token being lightened against its dark surface',
  },
  {
    route: '/blog/[[...slug]]',
    rule: 'aria-allowed-attr',
    target: 'input[type="search"]',
    impact: 'critical',
    reason: 'the header search input: it carries `aria-autocomplete` and `aria-expanded` while its implicit role is `searchbox`, where `aria-expanded` is not allowed — so the state of the suggestions popup is announced to nobody',
    repairedBy: 'SearchAutocomplete giving the input `role="combobox"` and an `aria-controls` naming its listbox, which is the role those two attributes belong to',
  },
  {
    route: '/blog/[[...slug]]',
    rule: 'color-contrast',
    target: 'small',
    impact: 'serious',
    reason: 'the brand tagline in the header (`<small>B2B · …</small>`) — `text-subtle` renders #a1a1aa, which is 2.56:1 on white at 10px against a 4.5:1 floor',
    repairedBy: 'the `--color-subtle` token being darkened, or this line moving off it',
  },
  {
    route: '/blog/[[...slug]]',
    rule: 'color-contrast',
    target: 'span',
    impact: 'serious',
    reason: 'the footer legal line (`© … NIP … KRS …`) — #71717a on the #18181b footer surface is 3.66:1 against 4.5:1',
    repairedBy: 'the footer muted token being lightened against its dark surface',
  },
  {
    route: '/cms/[...slug]',
    rule: 'aria-allowed-attr',
    target: 'input[type="search"]',
    impact: 'critical',
    reason: 'the header search input: it carries `aria-autocomplete` and `aria-expanded` while its implicit role is `searchbox`, where `aria-expanded` is not allowed — so the state of the suggestions popup is announced to nobody',
    repairedBy: 'SearchAutocomplete giving the input `role="combobox"` and an `aria-controls` naming its listbox, which is the role those two attributes belong to',
  },
  {
    route: '/cms/[...slug]',
    rule: 'color-contrast',
    target: 'small',
    impact: 'serious',
    reason: 'the brand tagline in the header (`<small>B2B · …</small>`) — `text-subtle` renders #a1a1aa, which is 2.56:1 on white at 10px against a 4.5:1 floor',
    repairedBy: 'the `--color-subtle` token being darkened, or this line moving off it',
  },
  {
    route: '/cms/[...slug]',
    rule: 'color-contrast',
    target: 'span',
    impact: 'serious',
    reason: 'the footer legal line (`© … NIP … KRS …`) — #71717a on the #18181b footer surface is 3.66:1 against 4.5:1',
    repairedBy: 'the footer muted token being lightened against its dark surface',
  },
];
