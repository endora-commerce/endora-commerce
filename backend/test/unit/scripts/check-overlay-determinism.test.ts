import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compareArtifact,
  coveredArtifactPaths,
} from '../../../scripts/check-overlay-determinism.js';

/**
 * The determinism gate's own test (issue #113).
 *
 * `overlay:check` is the only thing standing between a stale generated artifact
 * and `master`, and it had no test: its comparison lived inside a function that
 * read the disk and wrote to stderr, so the only way to see it fail was to
 * corrupt a committed file. The comparison is now injectable, and these cases
 * are the three ways an artifact can be wrong plus the one way the check itself
 * can be wrong.
 */

const PATH = '/repo/backend/src/modules/_lifecycle/manifest-index.generated.ts';
const RENDERED = 'export const DISCOVERED_MANIFESTS = [];\n';

describe('compareArtifact', () => {
  it('accepts a byte-identical committed file', () => {
    expect(compareArtifact(PATH, RENDERED, () => RENDERED)).toEqual({ ok: true });
  });

  it('refuses a committed file that drifted', () => {
    const verdict = compareArtifact(PATH, RENDERED, () => 'export const DISCOVERED_MANIFESTS = [1];\n');
    expect(verdict).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('refuses a trailing-newline difference — the artifact is compared by bytes', () => {
    expect(compareArtifact(PATH, RENDERED, () => RENDERED.trimEnd())).toMatchObject({
      ok: false,
      reason: 'stale',
    });
  });

  it('refuses a committed file that is gone', () => {
    const verdict = compareArtifact(PATH, RENDERED, () => {
      throw new Error('ENOENT');
    });
    expect(verdict).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('refuses an artifact the generator rendered empty, whatever is on disk', () => {
    // Two empty strings compare equal. A generator whose tree walk found no
    // module would otherwise report every artifact deterministic and current,
    // which is the shape of green this whole issue is about.
    expect(compareArtifact(PATH, '', () => '')).toMatchObject({ ok: false, reason: 'empty' });
    expect(compareArtifact(PATH, '   \n', () => '   \n')).toMatchObject({
      ok: false,
      reason: 'empty',
    });
  });
});

describe('coveredArtifactPaths', () => {
  const srcRoot = resolve(fileURLToPath(new URL('../../../src', import.meta.url)));

  function generatedFilesUnder(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) generatedFilesUnder(full, out);
      else if (name.endsWith('.generated.ts')) out.push(full);
    }
    return out;
  }

  it('covers every committed generated artifact, and names nothing else', () => {
    // The two-way ratchet the check itself cannot have: a generator that starts
    // emitting a fifth file, or a check that quietly stops comparing one, is a
    // committed artifact drifting from the tree with nothing watching. Run in
    // the bare-core shape, which is what the repository commits — a
    // per-deployment build renders a sixth artifact that is deliberately not
    // committed (issue #120).
    expect(generatedFilesUnder(srcRoot).sort()).toEqual([...coveredArtifactPaths()].sort());
  });
});
