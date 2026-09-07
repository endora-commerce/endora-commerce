// Storefront — Next.js configuration.
// Per Principle VII (SEO, Performance & Discoverability): this app is deliberately configured for
// server-side rendering of catalog/category/product pages so that search engines and LLM crawlers
// see fully rendered content without JavaScript execution.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_API_BASE_URL_VAR, absoluteHttpUrlProblem, environmentRefusal } from './lib/env.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The build refuses a storefront that does not know where its backend is.
 *
 * **This is the earliest moment the answer is decidable, and it is the only
 * moment at which it is still fixable.** Next inlines a `NEXT_PUBLIC_*` value
 * into the browser bundle: measured on this tree, `NEXT_PUBLIC_API_BASE_URL`
 * appears as a string literal in eleven client chunks. So the value is decided
 * here, at `next build`, and nothing downstream — not `next start`, not the
 * container's environment, not an operator — can change it afterwards. A
 * runtime throw would be a 500 a *visitor* discovers; this is a failed build the
 * person who caused it reads.
 *
 * Twelve reads of this variable answered an unset one with
 * `http://localhost:3001` until the owner's decision of 2026-09-06, and under
 * D-195 that default reached every client instance copied from this tree. The
 * whole shape of the defect was that the build **succeeded**.
 *
 * ## Why it is safe to ask here
 *
 * Next calls `loadEnvConfig(dir, …)` before it looks for a config file at all
 * (`next/dist/server/config.js`), so `storefront/.env` — the file
 * `README.md` § *Local development* tells a developer to create, and which
 * `.env.example` carries with the right value — is already loaded when this
 * runs. A developer who followed the documented setup never sees this.
 *
 * `process.exit` rather than a throw: a throw out of a config module is
 * reported wrapped in Next's own config-loading frames, and the sentence an
 * operator has to act on should not arrive inside a stack trace.
 *
 * The rule and the sentence are `./lib/env.mjs`', imported rather than restated:
 * one predicate, one message, for a variable whose build-time and run-time
 * consumers would otherwise be free to disagree about what "configured" means.
 *
 * **That file is `.mjs` rather than `.ts`, and it is this line that decides it.**
 * Next 15 does support `next.config.ts` — but its loader transpiles the config
 * through `next/dist/build/next-config-ts/require-hook`, which resolves
 * `typescript` from the *instance* and, failing that, tries to install it.
 * Measured on the `endora new storefront` acceptance criterion: a scaffolded
 * client instance has no `typescript` to resolve, so A5 (`next build` succeeds
 * outside the checkout) failed with `MODULE_NOT_FOUND` and A6 had no build to
 * boot. A configuration file that cannot be read by the tree it is copied into
 * is not a configuration file. JSDoc gives `./lib/env.mjs` its types, so the
 * twenty-four TypeScript call sites lose nothing.
 */
function requireBuildEnvironment() {
  const value = process.env[PUBLIC_API_BASE_URL_VAR];
  const problem = absoluteHttpUrlProblem(value);
  if (problem === null) return;
  process.stderr.write(`${environmentRefusal(PUBLIC_API_BASE_URL_VAR, problem, value)}\n`);
  process.exit(1);
}

requireBuildEnvironment();

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Cap the build's worker parallelism. `build:storefront` was killed by the
   * host's OOM killer on `master` (pipelines 11950 and 11951) even with
   * `resource_group: image-builds` giving it the machine to itself, so this is
   * the same "necessary and not sufficient" shape `.gitlab-ci.yml`'s Memory
   * block already records for the backend shards.
   *
   * Measured on one machine (16 cores), peak RSS of the whole process group:
   *
   *   default parallelism ................ 6144 MB
   *   `cpus: 2` .......................... 2722 MB
   *   `cpus: 1` .......................... 2777 MB
   *
   * Two workers cost the same as one and do more, so the jump is between two
   * and "as many as the host has cores" rather than being linear — which is
   * why a cap fixes this and a bigger box only postpones it.
   *
   * **A hypothesis measured and refuted, kept because it is the obvious one:**
   * `next build` re-runs the type-check and ESLint that `quality` has already
   * run over the whole tree, and disabling both looked like the lever. It is
   * not — 6334 MB without them against 6144 MB with, which is noise. The
   * duplication is real and is `build:admin`'s recorded reason for not running
   * `tsc`, but it is not what makes this build large.
   *
   * ## `webpackBuildWorker: true` — where the remaining peak actually was
   *
   * `conformance:storefront` was OOM-killed anyway (pipeline 13121, job 43732:
   * `Killed`, exit 137), with `cpus: 2` in force and, measured, no other job of
   * ours running beside it. So the cap above was necessary and not sufficient
   * here either, and the reason is that **static generation is no longer the
   * expensive phase — capping it moved the peak somewhere else and nobody
   * re-measured where.** Sampling the whole process group every 500 ms through
   * a build, on this machine, with `cpus: 2`:
   *
   *   t=2..33s   compile ......... parent alone, climbing to 1964 MB
   *   t=33..38s  type-check+lint . parent 1964 + two workers 602 + 586  <- PEAK
   *   t=52..58s  static gen ...... parent 1390 + three workers ~250 each
   *   t=63..91s  tracing/output .. parent alone, 2297 MB
   *
   * The peak is the parent **retaining the whole webpack compilation** while
   * Next's type-check and lint workers run beside it. `next build` normally
   * runs the compile in a worker that then exits, and it silently does not
   * here: `useBuildWorker` is `config.experimental.webpackBuildWorker ||
   * (config.experimental.webpackBuildWorker === undefined && !config.webpack)`
   * (`next/dist/build/index.js`), and this file defines `webpack()` below — so
   * the opt-out written for configs with non-serialisable plugin state took a
   * config whose whole `webpack()` sets `resolve.extensionAlias` and
   * `output.chunkLoadTimeout`. Asking for it explicitly is the whole fix.
   *
   * Measured on this machine, peak summed RSS of the process group, `cpus: 2`
   * throughout, warm cache, `next build` producing an identical standalone tree
   * and the same 64-entry `app-path-routes-manifest.json`:
   *
   *   as committed ....................... 3333 MB   97 s
   *   `webpackBuildWorker: true` ......... 2153 MB   98 s
   *
   * — a third of the demand for no wall clock, because the work did not change,
   * only which process holds it and for how long. Every phase now peaks in a
   * child that exits: compile 2153, type-check 1531, lint 1470, static gen
   * 1311, tracing 1117.
   *
   * It is in this file rather than in the CI job deliberately: `next build` is
   * also what `build:storefront`, `acceptance:storefront-scaffold` and a
   * client's own instance build run, and a third off the peak at no wall-clock
   * cost is worth having in all four. The scaffold copies this file verbatim
   * (`packages/cli/src/new-storefront/reference.ts` copies the reference
   * storefront's tracked files), so a client gets it by construction.
   *
   * **Two neighbouring knobs measured and not taken.** `cpus: 1` is 3232 MB
   * against `cpus: 2`'s 3333 — the earlier note above says two workers cost
   * what one does, and that still holds. `webpackMemoryOptimizations: true`
   * (string interning in the compiler) measured 2255 MB against 2153 on top of
   * the build worker, which is noise in the wrong direction.
   */
  experimental: { cpus: 2, webpackBuildWorker: true },
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained production server (`.next/standalone/storefront/server.js`)
  // for a slim Docker runtime image — no full node_modules at runtime.
  output: 'standalone',
  // The app lives in a pnpm monorepo; trace from the repo root so the workspace
  // packages (@endora-commerce/*) are bundled into the standalone output.
  outputFileTracingRoot: path.join(dirname, '..'),
  // Enable typed Link and route typing — surfaces missing routes at build time.
  typedRoutes: true,
  // Workspace packages resolve at `./dist` since feature 080 (T042). They stay on this
  // list because they are still ESM emitted from this monorepo rather than a published
  // tarball: Next.js applies its own SWC pipeline (`"use client"` boundaries, the JSX
  // runtime) only to what it transpiles. `extensionAlias` below is the other half — the
  // NodeNext `.js` specifiers in their relative imports resolved to `.ts`/`.tsx` before
  // the build existed and now resolve to the emitted `.js`, so both spellings are listed.
  transpilePackages: ['@endora-commerce/cms-components', '@endora-commerce/page-builder-core', '@endora-commerce/api-client', '@endora-commerce/contracts'],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.tsx', '.ts', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    // CMS Page Builder client chunk is large (Puck + shared components). Dev HMR
    // otherwise times out with ChunkLoadError when navigating to a CMS page.
    config.output = {
      ...config.output,
      chunkLoadTimeout: 120_000,
    };
    return config;
  },
  /**
   * A CMS page has one address and it is `/{slug}`
   * (`specs/105-cms-root-page-urls/contracts/cms-page-url.md` §1). `/cms/*` is
   * the address it was served at until then, so it answers a **permanent**
   * redirect (§2.3 — a temporary one tells a crawler to keep the old URL
   * indexed, which is the duplicate this feature removes).
   *
   * Static configuration rather than `middleware.ts` or a surviving route file
   * (§2.1): the mapping needs no request state, so Next answers it without
   * invoking the application, the middleware keeps its single job on a path
   * that runs on every request, and there is no second route file serving one
   * row.
   */
  async redirects() {
    return [{ source: '/cms/:path*', destination: '/:path*', permanent: true }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
