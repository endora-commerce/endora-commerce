/**
 * Lighthouse CI config (T242 / FR-103, SC-009).
 *
 * A performance and SEO-basics budget for the three SEO-critical surfaces:
 * catalog listing, category landing, and product detail page.
 *
 * ## Who runs it
 *
 * `perf:storefront` in `.gitlab-ci.yml` — a **scheduled** job, never a
 * merge-request gate, for the reason `perf:backend`'s header gives: these are
 * wall-clock assertions and the runner host is shared, so a Largest Contentful
 * Paint measured beside two live shards measures contention. It runs through
 * `scripts/perf-storefront.sh`, which boots the same stack
 * `conformance:storefront` boots, takes the two dynamic slugs from that boot's
 * fixture manifest, and invokes `pnpm dlx @lhci/cli@0.14.x` — pinned, and
 * deliberately a dependency of nothing (`plan.md` § Complexity Tracking of
 * `specs/098-storefront-ssr-seo-a11y-suite/`).
 *
 * This header used to say **"NOT RUN BY CI"**, and it was accurate: `5b0bfb5dd`
 * deleted the GitHub Actions workflows that ran it, and from then until feature
 * 098's Phase 5 the Core Web Vitals budget (Constitution VII) was enforced by a
 * developer remembering to run three commands. Both halves changed in one merge
 * request on purpose — a file describing a state that a later change silently
 * invalidates is the shape this estate keeps finding (FR-051).
 *
 * By hand, against a stack you already have up:
 *   STOREFRONT_BASE_URL=http://127.0.0.1:3000 \
 *   SAMPLE_PRODUCT_SLUG=… SAMPLE_CATEGORY_SLUG=… \
 *     pnpm dlx @lhci/cli@0.14.x autorun
 *
 * Or the whole thing, boot included — this is what CI runs:
 *   pnpm dev:infra
 *   DATABASE_URL=postgresql://b2b:b2b@localhost:5432/b2b_perf_test \
 *     bash scripts/perf-storefront.sh --record
 *
 * ## What it does not assert, and why the preset is gone
 *
 * **Accessibility.** `color-contrast` and `heading-order` stood here at `warn`
 * — the only accessibility assertions in the repository, at warning level, in a
 * config nothing ran. `conformance:storefront` asks both questions of a booted
 * page with axe, at `serious`/`critical` and against a two-way ledger
 * (`contracts/accessibility-floor.md` §6). Two derivations of one question are
 * two answers waiting to disagree, and a `warn` quietly disagreeing with a
 * `fail` is the worst direction available.
 *
 * Deleting those two lines is not enough, and this was measured rather than
 * reasoned: `preset: 'lighthouse:no-pwa'` asserts **every** Lighthouse audit,
 * the whole accessibility category included, at `error`. The first real run of
 * this config failed `aria-allowed-attr` and `target-size` — two axe rules
 * `conformance:storefront` owns — so removing the two `warn` entries under a
 * preset would have *promoted* the same questions to `error`, in the job that
 * is not the one that owns them. The preset is therefore gone and the
 * assertions below are enumerated: Core Web Vitals, and the SEO basics
 * Lighthouse is good at. Nothing here is asserted anywhere else.
 */

const STOREFRONT_BASE = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const SAMPLE_PRODUCT_SLUG = process.env.SAMPLE_PRODUCT_SLUG ?? 'example-simple-product';
const SAMPLE_CATEGORY_SLUG = process.env.SAMPLE_CATEGORY_SLUG ?? 'widgets';

/**
 * Three runs per URL on the nightly, five on `weekly-heavy`. A drift smaller
 * than the run-to-run spread is invisible at three samples, and six extra
 * Lighthouse runs have no place in a nightly.
 *
 * Which of the two this is is decided by `scripts/perf-storefront.sh` through
 * `scripts/lib/schedule-kind.sh` and arrives here as `LHCI_NUMBER_OF_RUNS`. The
 * `3` below is therefore the answer for a run with no schedule at all — a
 * developer's — and not a silent stand-in for one whose schedule failed to say:
 * the resolver refuses that state rather than falling through to it.
 */
const NUMBER_OF_RUNS = Number(process.env.LHCI_NUMBER_OF_RUNS ?? 3);

/**
 * The statistic the thresholds below were derived from, stated rather than
 * inherited. `lhci`'s default for a `maxNumericValue` assertion is
 * **optimistic** — the *best* of the N runs must meet the budget — which is a
 * budget met by the luckiest sample. Measured on the recording runs: over the
 * values 0.871 / 0.439 / 0.871 the default reported `found: 0.438833`.
 */
const MEDIAN = { aggregationMethod: 'median' };

/**
 * Chrome refuses to start as root unless it is told not to sandbox itself:
 *
 *   ERROR: Running as root without --no-sandbox is not supported.
 *   LH:ChromeLauncher:error connect ECONNREFUSED 127.0.0.1:44837
 *
 * That is the whole of `perf:storefront`'s failure in pipeline 13444 — the
 * launcher never got a browser, Lighthouse wrote no report, and
 * `scripts/perf-storefront.sh` correctly refused to call the run a pass.
 *
 * **`--no-sandbox` is safe here and is bad advice in general.** Chrome's
 * sandbox confines a renderer that has been compromised by the page it is
 * rendering; switching it off is only acceptable when something else already
 * confines the process. In this job that something is the job container itself:
 * a throwaway, unprivileged docker container with no credentials of ours in it,
 * driving a storefront this pipeline built from this commit and seeded itself.
 * On a developer's machine none of that holds, and the flag is not passed
 * there.
 *
 * So the flag is **derived from the condition that requires it** rather than
 * set unconditionally: root, which is what Chrome itself objects to, and what
 * the GitLab docker executor gives this job. A non-root run — every developer
 * one — keeps its sandbox, and nothing has to remember to take the flag off.
 *
 * `chromeFlags` is a space-separated string, which is what `@lhci/cli@0.14`
 * hands to the launcher (`cli/src/collect/node-runner.js`), appending its own
 * `--headless=new`. If a future run dies on a renderer crash rather than on a
 * launch failure, `--disable-dev-shm-usage` is the next flag to reach for: the
 * docker executor's default `/dev/shm` is 64 MB. It is deliberately not passed
 * today, because nothing has measured a need for it.
 */
const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const CHROME_FLAGS = RUNNING_AS_ROOT ? '--no-sandbox' : '';

module.exports = {
  ci: {
    collect: {
      url: [
        `${STOREFRONT_BASE}/catalog`,
        `${STOREFRONT_BASE}/c/${SAMPLE_CATEGORY_SLUG}`,
        `${STOREFRONT_BASE}/p/${SAMPLE_PRODUCT_SLUG}`,
      ],
      numberOfRuns: NUMBER_OF_RUNS,
      settings: {
        preset: 'desktop',
        // See CHROME_FLAGS above: empty off root, `--no-sandbox` on it.
        chromeFlags: CHROME_FLAGS,
        // Throttle to a moderate-mobile profile so the CWV thresholds
        // match the FR-103 "75th-percentile mid-range mobile" target.
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
        },
      },
    },
    assert: {
      assertions: {
        // ------------------------------------------------------------------
        // Core Web Vitals — FR-103 / Constitution Principle VII.
        //
        // **These are re-based numbers, not the "Good" thresholds, and the gap
        // is a finding rather than a decision.** D-65's rule for `perf:backend`
        // applies here unchanged: a budget is a regression detector on the
        // machine that runs it, and a threshold carried over from somewhere
        // else is a number with no error bar.
        //
        // Derivation — four collections, three runs per URL each, 36 samples,
        // over one `next build` on a 16-core developer machine under the
        // throttling above. Per-URL medians, collection 1 / 2 / 3 / 4:
        //
        //                 /catalog                  /c/<slug>                 /p/<slug>
        //   LCP (ms)  6505 6578 6530  8466    7121 6041 6192 6422    5022 10804 4903 5023
        //   TBT (ms)  2811 4665 4422  8104    3570 2152 2792 3516    3201 11082 2408 2634
        //   FCP (ms)  3836 3845 3865  3850    3547 3388 3540 3556    3566  3470 3553 3542
        //   CLS       .871 .871 .871  .436    .439 .439 .439 .439    .709  .355 .355 .709
        //
        // The outliers are named rather than dropped, because they are the
        // reason for the headroom: collections 2 and 4 were taken on a box at
        // load average 17 with two other builds running, and they moved the
        // *median* — two of collection 4's three catalog runs were degraded
        // (TBT 4333 / 8104 / 25736). That is the contention `perf:backend`'s
        // header refuses to measure a p95 beside, and the CI host is shared by
        // construction, which is why `perf:storefront`, `perf:backend` and
        // `conformance:storefront` share a `resource_group` and why the
        // headroom below is 50% rather than a tidier number.
        //
        // Worst uncontended median per metric: LCP 7121 ms, TBT 4665 ms,
        // FCP 3865 ms, CLS 0.871. The thresholds are those plus ~50% — except
        // CLS, which needs almost none and is the one metric here that is not
        // about the machine at all. It is **bimodal per page** and each pair is
        // a factor of two (catalog .436 / .871, PDP .355 / .709): the same
        // shift landing once or twice, never a spread. 0.9 covers the worst
        // value observed in 36 samples.
        //
        // Confirmed rather than only computed: two further collections against
        // a freshly booted stack met every threshold above, the second of them
        // a full run from an empty database in 6m38s.
        //
        // **They are a starting point, and on the wrong hardware.** The first
        // three runs of `perf:storefront` on the CI runner are RECORDING runs —
        // `scripts/perf-storefront.sh --record` prints every value and every
        // median — and these numbers are to be re-based from what a 4 vCPU
        // shared runner measures, exactly as `perf:backend`'s defaults were.
        //
        // **The distance to "Good" is the debt this job found on its first
        // run.** Good is LCP ≤ 2500 ms and CLS ≤ 0.1; this storefront serves
        // 4.9–7.1 s and 0.36–0.87. Asserting 2500 / 0.1 today would make the
        // nightly red every night from the first one, which is a nightly nobody
        // reads — worse than not measuring. The repair is a performance feature
        // of its own; this job is what stops it getting quietly worse meanwhile.
        'largest-contentful-paint': ['error', { maxNumericValue: 11000, ...MEDIAN }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.9, ...MEDIAN }],
        // Total Blocking Time, not Interaction to Next Paint. `lhci` reported
        // `interaction-to-next-paint warning for auditRan … found: 0` on all
        // three URLs: INP is a field metric, Lighthouse's lab run produces no
        // value for it, and the `['warn', { maxNumericValue: 200 }]` entry that
        // stood here asserted an audit that never ran. TBT is the lab proxy
        // Lighthouse itself scores responsiveness with, and it has a value.
        'total-blocking-time': ['error', { maxNumericValue: 7500, ...MEDIAN }],
        'first-contentful-paint': ['warn', { maxNumericValue: 4500, ...MEDIAN }],
        // ------------------------------------------------------------------
        // SEO basics. Binary, cheap, and about the served document rather than
        // about this machine, so they carry no re-basing question.
        'document-title': ['error', { minScore: 1 }],
        'meta-description': ['error', { minScore: 1 }],
        'crawlable-anchors': ['error', { minScore: 1 }],
        'http-status-code': ['error', { minScore: 1 }],
      },
    },
    upload: {
      // The filesystem, and not `temporary-public-storage`, which uploads a
      // client's storefront report to Google-hosted public storage on every
      // nightly. This directory is `perf:storefront`'s artifact.
      target: 'filesystem',
      outputDir: './storefront/test-results/lighthouse',
    },
  },
};
