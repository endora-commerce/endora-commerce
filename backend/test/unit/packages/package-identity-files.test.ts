import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { classifyWorkspaceMembers } from '@endora-commerce/cli/lib/workspace-packages.js';

import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { nodeManifestFs, type ManifestFs } from '../../../scripts/lib/module-package-manifest.js';
import {
  GENERATED_README_MARKER,
  PackageIdentityError,
  renderPackageIdentityFiles,
} from '../../../scripts/lib/package-identity-files.js';

/**
 * Every published package ships the two files npm force-includes
 * (`specs/123-oss-install-experience/` FR-020 and FR-021, tasks T6-B and T6-C).
 *
 * The property this file exists for is a statement about the **tree**, not
 * about the renderer: on `origin/master` at 2026-09-15, **0** of the 82
 * publishable members carried a `LICENSE` and **14** carried a `README.md`, so
 * the first public publish would have put 82 tarballs with no licence text and
 * 68 empty package pages onto a registry. A renderer alone cannot hold that
 * shut — somebody deletes a file, or adds the 83rd package and never runs the
 * generator — so the two coverage assertions below derive the population from
 * `pnpm-workspace.yaml` independently of the run and ask the disk directly.
 *
 * The red proofs are a synthetic checkout handed in at the top of the analysis
 * (issue #130), because every refusal here is about a tree the renderer must
 * not guess its way through: a missing root `LICENSE` is a grant nobody wrote,
 * a missing `description` is a page that says only the package's own name, and
 * an unknown module subpath is a published entry point rendering as a blank
 * cell.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

/** An in-memory checkout, so nothing about a proof is precomputed. */
function fixtureFs(files: Readonly<Record<string, string>>): ManifestFs {
  const paths = Object.keys(files);
  const childrenOf = (dir: string, wantDirectory: boolean): readonly string[] => {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const names = new Set<string>();
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const tail = path.slice(prefix.length);
      const cut = tail.indexOf('/');
      const isDirectory = cut >= 0;
      if (isDirectory !== wantDirectory) continue;
      names.add(isDirectory ? tail.slice(0, cut) : tail);
    }
    return [...names].sort();
  };
  return {
    readText: (path) => files[path] ?? null,
    listDirectories: (path) => childrenOf(path, true),
    listFiles: (path) => childrenOf(path, false),
  };
}

const ROOT = '/repo';
const MIT = 'MIT License\n\nCopyright (c) 2026 Endora\n';

/** A checkout with the root licence and one publishable member, plus whatever a proof adds. */
function checkoutWith(extra: Readonly<Record<string, string>>): Record<string, string> {
  return {
    [`${ROOT}/pnpm-workspace.yaml`]: 'packages:\n  - backend\n  - packages/*\n',
    [`${ROOT}/LICENSE`]: MIT,
    [`${ROOT}/backend/package.json`]: JSON.stringify({ name: 'backend', private: true }),
    ...extra,
  };
}

function libraryMember(
  name: string,
  manifest: Readonly<Record<string, unknown>> = {},
): Record<string, string> {
  return {
    [`${ROOT}/packages/${name}/package.json`]: JSON.stringify({
      name: `@endora-commerce/${name}`,
      description: 'A one-sentence description a human wrote.',
      license: 'MIT',
      ...manifest,
    }),
  };
}

describe('every published package ships a LICENSE and a README (FR-020, FR-021)', () => {
  describe('over this checkout', () => {
    it('renders every committed LICENSE and README byte-identically', () => {
      expect(repoRoot).not.toBeNull();
      const run = renderPackageIdentityFiles(repoRoot!, nodeManifestFs());
      expect(run.licenses.length).toBeGreaterThan(0);
      expect(run.readmes.length).toBeGreaterThan(0);
      for (const artefact of [...run.licenses, ...run.readmes]) {
        expect(readFileSync(artefact.outputPath, 'utf8'), artefact.outputPath).toBe(
          artefact.content,
        );
      }
    });

    it('is idempotent — a second render over its own output changes nothing', () => {
      const first = renderPackageIdentityFiles(repoRoot!, nodeManifestFs());
      const second = renderPackageIdentityFiles(repoRoot!, nodeManifestFs());
      expect(second.readmes.map((entry) => entry.content)).toEqual(
        first.readmes.map((entry) => entry.content),
      );
      expect(second.licenses.map((entry) => entry.content)).toEqual(
        first.licenses.map((entry) => entry.content),
      );
    });

    it('leaves every publishable package directory carrying a LICENSE on disk', () => {
      // The population is derived from `pnpm-workspace.yaml` here rather than
      // taken from the run, so a renderer that walked short cannot report the
      // gap as covered. Measured before this feature: 0 of 82.
      const publishable = publishableMembers();
      expect(publishable.length).toBeGreaterThan(0);
      const without = publishable
        .filter((member) => !existsSync(join(member.dir, 'LICENSE')))
        .filter((member) => !existsSync(join(member.dir, 'LICENSE.md')))
        .map((member) => member.name);
      expect(without).toEqual([]);
    });

    it('leaves every publishable package directory carrying a README on disk', () => {
      // Measured before this feature: 14 of 82, so 68 registry pages would
      // have rendered empty. Hand-written and generated both satisfy it — the
      // requirement is a page, not a provenance.
      const without = publishableMembers()
        .filter((member) => !existsSync(join(member.dir, 'README.md')))
        .map((member) => member.name);
      expect(without).toEqual([]);
    });

    it('copies the root licence text verbatim, never a variant of it', () => {
      const run = renderPackageIdentityFiles(repoRoot!, nodeManifestFs());
      const root = readFileSync(join(repoRoot!, 'LICENSE'), 'utf8');
      for (const artefact of run.licenses) {
        expect(artefact.content, artefact.outputPath).toBe(root);
      }
    });

    it('leaves no LICENSE beside a package that declares its own terms', () => {
      // The renderer skips such a member, so a `LICENSE` left over from the
      // days it took the workspace default is nobody's to delete — and it is
      // the permissive text, which npm packs whatever `files` says. Two
      // licences in one tarball is the grant `packageLicense` exists to stop.
      const run = renderPackageIdentityFiles(repoRoot!, nodeManifestFs());
      const own = new Set(run.ownLicenceMembers);
      const leftover = publishableMembers()
        .filter((member) => own.has(member.name))
        .filter((member) => existsSync(join(member.dir, 'LICENSE')))
        .map((member) => member.name);
      expect(leftover).toEqual([]);
    });

    it('rewrites no README a human owns', () => {
      const run = renderPackageIdentityFiles(repoRoot!, nodeManifestFs());
      expect(run.handWrittenReadmes.length).toBeGreaterThan(0);
      const generated = new Set(run.readmes.map((entry) => entry.packageName));
      for (const name of run.handWrittenReadmes) {
        expect(generated.has(name), `${name} is rendered and hand-written at once`).toBe(false);
      }
      expect(run.handWrittenReadmes.length + run.readmes.length).toBe(run.memberNames.length);
    });
  });

  describe('the licence half refuses rather than guesses', () => {
    it('refuses a checkout with no root LICENSE', () => {
      const files = checkoutWith(libraryMember('alpha'));
      delete files[`${ROOT}/LICENSE`];
      expect(() => renderPackageIdentityFiles(ROOT, fixtureFs(files))).toThrow(
        PackageIdentityError,
      );
    });

    it('refuses a publishable member that declares no licence', () => {
      const files = checkoutWith({
        [`${ROOT}/packages/alpha/package.json`]: JSON.stringify({
          name: '@endora-commerce/alpha',
          description: 'A sentence.',
        }),
      });
      expect(() => renderPackageIdentityFiles(ROOT, fixtureFs(files))).toThrow(
        /declares no `license`/,
      );
    });

    it('writes no LICENSE beside a package that declares its own', () => {
      // The open-core mechanism `LICENSING.md` fixes: the package
      // ships the file its `SEE LICENSE IN` names, and putting the root's
      // permissive text beside it would be two licences in one directory.
      const files = checkoutWith(
        libraryMember('paid', { license: 'SEE LICENSE IN LICENSE.md' }),
      );
      const run = renderPackageIdentityFiles(ROOT, fixtureFs(files));
      expect(run.licenses).toEqual([]);
      expect(run.ownLicenceMembers).toEqual(['@endora-commerce/paid']);
      // And it is still counted as covered, so the run does not read as short.
      expect(run.memberNames).toEqual(['@endora-commerce/paid']);
    });

    it('skips a private member and an application alike', () => {
      const files = checkoutWith({
        ...libraryMember('alpha'),
        ...libraryMember('internal', { private: true }),
      });
      const run = renderPackageIdentityFiles(ROOT, fixtureFs(files));
      expect(run.memberNames).toEqual(['@endora-commerce/alpha']);
    });

    it('refuses a workspace whose globs reach no publishable package', () => {
      const files = checkoutWith({});
      expect(() => renderPackageIdentityFiles(ROOT, fixtureFs(files))).toThrow(/issue #113/);
    });
  });

  describe('the README says what the package declares about itself', () => {
    it('refuses a member with no description rather than writing its name twice', () => {
      const files = checkoutWith({
        [`${ROOT}/packages/alpha/package.json`]: JSON.stringify({
          name: '@endora-commerce/alpha',
          license: 'MIT',
        }),
      });
      expect(() => renderPackageIdentityFiles(ROOT, fixtureFs(files))).toThrow(
        /declares no `description`/,
      );
    });

    it('refuses a module subpath it has no meaning for', () => {
      const files = checkoutWith(
        libraryMember('mod-alpha', {
          endora: { type: 'module', id: 'alpha' },
          exports: { '.': './dist/manifest.js', './storefront': './dist/storefront/index.js' },
        }),
      );
      expect(() => renderPackageIdentityFiles(ROOT, fixtureFs(files))).toThrow(
        /MODULE_SUBPATH_MEANINGS/,
      );
    });

    it('names the module id, the entry points and the peers', () => {
      const files = checkoutWith(
        libraryMember('mod-alpha', {
          description: 'Alpha does a thing.',
          endora: { type: 'module', id: 'alpha' },
          exports: { '.': './dist/manifest.js', './backend': './dist/backend/index.js' },
          files: ['dist', 'i18n'],
          peerDependencies: { '@endora-commerce/platform': 'workspace:*', zod: '^4' },
          peerDependenciesMeta: { zod: { optional: true } },
        }),
      );
      files[`${ROOT}/packages/mod-alpha/i18n/en.json`] = '{}';
      files[`${ROOT}/packages/mod-alpha/i18n/pl.json`] = '{}';
      const [readme] = renderPackageIdentityFiles(ROOT, fixtureFs(files)).readmes;
      const content = readme!.content;
      expect(content.startsWith(GENERATED_README_MARKER)).toBe(true);
      expect(content).toContain('Alpha does a thing.');
      expect(content).toContain('module id is `alpha`');
      expect(content).toContain('`@endora-commerce/mod-alpha/backend`');
      expect(content).toContain('`@endora-commerce/platform`');
      expect(content).toContain('`zod` ^4 — *optional*');
      // A `workspace:` range is this repository's link protocol and is rewritten
      // at publish time, so printing it would be printing a build artefact.
      expect(content).not.toContain('workspace:');
      expect(content).toContain('`en`, `pl`');
    });

    it('describes a package that installs an executable as one', () => {
      const files = checkoutWith(
        libraryMember('tooling', { bin: { endora: './dist/bin/endora.js' } }),
      );
      const [readme] = renderPackageIdentityFiles(ROOT, fixtureFs(files)).readmes;
      expect(readme!.content).toContain('puts `endora` on the path');
      expect(readme!.content).toContain('pnpm add -D @endora-commerce/tooling');
    });

    it('points the licence section at the file a `SEE LICENSE IN` declaration names', () => {
      // Such a package ships no `LICENSE` — the renderer writes none beside it —
      // so a README sending the reader to `LICENSE` sends them to nothing.
      const files = checkoutWith(
        libraryMember('alpha', { license: 'SEE LICENSE IN LICENSE.md' }),
      );
      const [readme] = renderPackageIdentityFiles(ROOT, fixtureFs(files)).readmes;
      const licence = readme!.content.slice(readme!.content.indexOf('## Licence'));
      expect(licence).toContain('`LICENSE.md`');
      expect(licence).not.toContain('`LICENSE`');
      expect(licence).not.toContain('SEE LICENSE IN');
    });

    it('keeps pointing a package that takes the default at `LICENSE`', () => {
      const files = checkoutWith(libraryMember('alpha'));
      const [readme] = renderPackageIdentityFiles(ROOT, fixtureFs(files)).readmes;
      expect(readme!.content).toContain('MIT — the text is in `LICENSE`, beside this file.');
    });

    it('leaves a README without the marker alone and regenerates one with it', () => {
      const files = checkoutWith({
        ...libraryMember('alpha'),
        ...libraryMember('beta'),
      });
      files[`${ROOT}/packages/alpha/README.md`] = '# Written by a person\n';
      files[`${ROOT}/packages/beta/README.md`] = `${GENERATED_README_MARKER}\n\n# stale\n`;
      const run = renderPackageIdentityFiles(ROOT, fixtureFs(files));
      expect(run.handWrittenReadmes).toEqual(['@endora-commerce/alpha']);
      expect(run.readmes.map((entry) => entry.packageName)).toEqual([
        '@endora-commerce/beta',
      ]);
      expect(run.readmes[0]!.content).not.toContain('# stale');
    });

    it('describes the manifest this run is about to write, not the one on disk', () => {
      // Otherwise one regeneration leaves the README a generation behind the
      // `package.json` beside it, and the command's idempotence needs a second
      // pass to hold.
      const files = checkoutWith(libraryMember('alpha', { description: 'Stale sentence.' }));
      const run = renderPackageIdentityFiles(
        ROOT,
        fixtureFs(files),
        new Map([
          [
            `${ROOT}/packages/alpha`,
            JSON.stringify({
              name: '@endora-commerce/alpha',
              description: 'Fresh sentence.',
              license: 'MIT',
            }),
          ],
        ]),
      );
      expect(run.readmes[0]!.content).toContain('Fresh sentence.');
      expect(run.readmes[0]!.content).not.toContain('Stale sentence.');
    });
  });

  it('counts what it opened', () => {
    const run = renderPackageIdentityFiles(repoRoot!, nodeManifestFs());
    // The root licence plus one manifest per workspace member, at the least.
    expect(run.filesRead).toBeGreaterThan(run.memberNames.length);
  });
});

/** The publishable members, derived from the workspace globs rather than from a run. */
function publishableMembers(): ReadonlyArray<{ readonly dir: string; readonly name: string }> {
  return classifyWorkspaceMembers(repoRoot!, nodeManifestFs()).members.filter(
    (member) => member.family && member.manifest['private'] !== true,
  );
}
