import { readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { classifyWorkspaceMembers } from '@endora-commerce/cli/lib/workspace-packages.js';

import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { nodeManifestFs } from '../../../scripts/lib/module-package-manifest.js';
import { DEFAULT_INTERNAL_HOSTS } from '../../../scripts/pre-publication-scan.js';

/**
 * Every package this repository publishes points back at the canonical
 * repository (`specs/129-github-canonical-migration/` T050, D-242 step 5).
 *
 * A published version is immutable, and its `repository` is the link a
 * stranger evaluating the package follows first — and the field npm's
 * provenance verification compares against the repository the attestation
 * names. At the W2.5 read of the canonical tree, 72 manifests still named the
 * historical GitLab host, which nobody outside the team can open. So the
 * property is stated about the **tree**: the population is derived from
 * `pnpm-workspace.yaml` (every library-family member, the one private-by-ruling
 * member included, since it is flipped public before the first publish), not
 * taken from the generator, which renders only the module packages and would
 * leave the eleven hand-written manifests unexamined.
 */

/** The canonical repository, in the spelling npm normalises `repository.url` to. */
const CANONICAL_URL = 'git+https://github.com/endora-commerce/endora-commerce.git';
/** The prefix every other published URL (`homepage`, `bugs`) must start from. */
const CANONICAL_WEB = 'https://github.com/endora-commerce/endora-commerce';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

function familyMembers(): ReadonlyArray<{
  readonly dir: string;
  readonly name: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}> {
  return classifyWorkspaceMembers(repoRoot!, nodeManifestFs()).members.filter(
    (member) => member.family,
  );
}

function posixRelative(dir: string): string {
  return relative(repoRoot!, dir).split(sep).join('/');
}

/** Every string under a manifest field, however deeply nested. */
function stringsIn(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
}

describe('every published package names the canonical repository (129 T050)', () => {
  it('derives a non-empty population', () => {
    expect(repoRoot).not.toBeNull();
    expect(familyMembers().length).toBeGreaterThan(0);
  });

  it('declares the canonical `repository.url` at the workspace root, the source the generator reads', () => {
    const root = JSON.parse(readFileSync(join(repoRoot!, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(root['repository']).toEqual({ type: 'git', url: CANONICAL_URL });
  });

  it('gives every package `{ type: git, url: <canonical>, directory: <its own path> }`', () => {
    const wrong = familyMembers()
      .filter((member) => {
        const expected = { type: 'git', url: CANONICAL_URL, directory: posixRelative(member.dir) };
        return JSON.stringify(member.manifest['repository']) !== JSON.stringify(expected);
      })
      .map((member) => `${member.name}: ${JSON.stringify(member.manifest['repository'])}`);
    expect(wrong).toEqual([]);
  });

  it('names no other host in any field a registry publishes as a link', () => {
    const offending: string[] = [];
    for (const member of familyMembers()) {
      for (const field of ['repository', 'homepage', 'bugs'] as const) {
        for (const value of stringsIn(member.manifest[field])) {
          if (!/^(?:git\+)?https?:\/\//.test(value)) continue;
          if (value === CANONICAL_URL || value.startsWith(CANONICAL_WEB)) continue;
          offending.push(`${member.name} ${field}: ${value}`);
        }
      }
      // `publishConfig` may legitimately name a public registry, so only the
      // internal hosts the pre-publication scan names are refused there.
      for (const value of stringsIn(member.manifest['publishConfig'])) {
        if (DEFAULT_INTERNAL_HOSTS.some((host) => value.includes(host))) {
          offending.push(`${member.name} publishConfig: ${value}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });
});
