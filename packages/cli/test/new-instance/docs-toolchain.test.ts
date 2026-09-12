/**
 * `DOCS_TOOLCHAIN` is held to the documentation site **this repository builds**
 * (`specs/110-instance-repository/contracts/instance-tree.md` §2.4a, R2.5a).
 *
 * ## Why this file is the mechanism and not a nicety
 *
 * Every other range `endora new instance` writes is read off a manifest the run
 * resolved, because in each case a package owns the statement. Nothing in this
 * estate owns a statement about Docusaurus — no module package peers on it, the
 * platform does not, the admin shell does not — and the two ways of inventing
 * an owner were both measured wrong (`src/new-instance/docs-toolchain.ts`'s own
 * header has the numbers). So the declaration is a constant, and **this** is
 * what keeps it from being a value nobody reviewed: the Docusaurus we ask a
 * client to build their documentation with is the Docusaurus we build ours
 * with, and a bump on either side is red until it is a bump on both.
 *
 * ## Two directions, because they are different defects
 *
 * A name the declaration carries and the site does not is a client asked for a
 * package this repository does not use. A name the site carries in the role the
 * declaration describes and the declaration does not is the state §2.4a's
 * omission exists for, arriving silently — the member would simply not be
 * written, or would be written short.
 *
 * The second direction is deliberately **narrow**: `docs/package.json` declares
 * `@mdx-js/react`, `clsx` and `prism-react-renderer` too, and an instance's
 * four-file member needs none of them. So what is reconciled is the
 * `@docusaurus/*` **runtime** dependencies — the packages the site cannot be
 * built without — and the type packages that member deliberately does without
 * are named here as the exclusion rather than left to be rediscovered.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DOCS_TOOLCHAIN } from '../../src/new-instance/docs-toolchain.js';

/**
 * The site, found by walking up for the workspace member that holds a
 * Docusaurus configuration.
 *
 * Never a path written down: `docs/` is where this repository's site is today,
 * and the derivation that finds it is `resolveDocsLayout`'s — a member holding
 * a `docusaurus.config.*`. Zero is a refusal, because a reconciliation with
 * nothing on the other side passes whatever the declaration says.
 */
function siteManifest(): Record<string, unknown> {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    for (const name of ['docs', 'website', 'site']) {
      const candidate = join(current, name);
      const configured = ['js', 'mjs', 'cjs', 'ts'].some((extension) =>
        existsSync(join(candidate, `docusaurus.config.${extension}`)),
      );
      if (configured && existsSync(join(candidate, 'package.json'))) {
        return JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')) as Record<
          string,
          unknown
        >;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        'no workspace member above this test holds a Docusaurus configuration, so there is ' +
          'no site to reconcile `DOCS_TOOLCHAIN` against and the reconciliation would pass ' +
          'whatever it declared',
      );
    }
    current = parent;
  }
}

/**
 * The `@docusaurus/*` packages the site declares as **runtime** dependencies.
 *
 * `devDependencies` is where its three type packages sit, and those are exactly
 * what §2.4a's `.js` configuration files exist to avoid needing. Reading
 * `dependencies` alone is therefore the same predicate the member applies, not
 * a convenience.
 */
function siteDocusaurusDependencies(): ReadonlyMap<string, string> {
  const block = siteManifest()['dependencies'];
  const entries = Object.entries((block ?? {}) as Record<string, string>).filter(([name]) =>
    name.startsWith('@docusaurus/'),
  );
  return new Map(entries);
}

describe('DOCS_TOOLCHAIN is the documentation site this repository builds', () => {
  it('declares something at all, and every entry carries its reason', () => {
    expect(DOCS_TOOLCHAIN.length).toBeGreaterThan(0);
    for (const entry of DOCS_TOOLCHAIN) {
      expect(entry.name.length, 'a nameless entry').toBeGreaterThan(0);
      expect(entry.range, `${entry.name} declares no range`).toMatch(/^[\^~]?\d+\./);
      expect(entry.why.length, `${entry.name} says nothing about why it is there`)
        .toBeGreaterThan(20);
    }
  });

  it('reads a real site manifest — not an empty one that would pass anything', () => {
    expect(siteDocusaurusDependencies().size).toBeGreaterThan(0);
  });

  it('asks a client for no package this repository does not use', () => {
    const site = siteDocusaurusDependencies();
    const unused = DOCS_TOOLCHAIN.filter((entry) => !site.has(entry.name)).map(
      (entry) => entry.name,
    );
    expect(unused, 'declared for an instance and used by no site here').toEqual([]);
  });

  it('asks for no version this repository does not build with', () => {
    const site = siteDocusaurusDependencies();
    const drift = DOCS_TOOLCHAIN.filter((entry) => site.get(entry.name) !== entry.range).map(
      (entry) => `${entry.name}: declared ${entry.range}, the site builds with ${
        site.get(entry.name) ?? '(nothing)'
      }`,
    );
    expect(drift).toEqual([]);
  });

  it('carries every runtime `@docusaurus/*` package the site depends on', () => {
    const declared = new Set(DOCS_TOOLCHAIN.map((entry) => entry.name));
    const missing = [...siteDocusaurusDependencies().keys()].filter(
      (name) => !declared.has(name),
    );
    expect(
      missing,
      'the site builds with these and an instance would be scaffolded without them',
    ).toEqual([]);
  });

  it('carries no type package — §2.4a writes `.js`, so there is nothing to type', () => {
    for (const entry of DOCS_TOOLCHAIN) {
      expect(entry.name).not.toMatch(/tsconfig|types|module-type-aliases/);
    }
  });

  /**
   * React is Docusaurus's own peer and is deliberately not here — declaring it
   * would be a second spelling of a range `@docusaurus/core` owns.
   */
  it('declares neither `react` nor `react-dom`', () => {
    expect(DOCS_TOOLCHAIN.map((entry) => entry.name)).not.toContain('react');
    expect(DOCS_TOOLCHAIN.map((entry) => entry.name)).not.toContain('react-dom');
  });
});
