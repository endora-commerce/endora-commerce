import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * The estate's Node floor, and the one capability it exists to buy (D-236).
 *
 * ## What the floor is for
 *
 * A deployment's overlay module is a `.ts` file that **nothing compiles**: in a
 * scaffolded instance the backend member's `tsconfig.json` is `rootDir: 'src'`,
 * `include: ['src']`, and `apps/` is outside the member entirely, while
 * `overlayModulesUnder` reaches the unit with a bare dynamic `import()`
 * (`UNIT_EXTENSIONS = ['.js', '.ts']` in
 * `packages/platform/src/overlay/overlay-runtime.ts`). Emitting a `.js` beside
 * the client's `.ts` was measured and refused — the loader resolves `.js`
 * first while the divergence derivation admits both, so the sibling doubles
 * every seam site in the report. So the tree holds one file per unit, that file
 * is TypeScript, and **the runtime that reads it has to strip types without
 * being asked**.
 *
 * That is why the floor is a *behavioural* requirement and not a preference,
 * and why the first assertion below spawns a real `node` over a real `.ts`
 * rather than comparing version strings: `--experimental-strip-types` is
 * accepted and silent on stderr on releases that both do and do not strip by
 * default, so a test that asked about the flag would pass on a runtime that
 * throws `ERR_UNKNOWN_FILE_EXTENSION` the moment a client writes an overlay
 * module. Measured on the acceptance criterion, 2026-09-14: on Node 22.17.1 the
 * `acceptance:instance` A8 step reports
 * `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for
 * …/apps/instance/modules/instance_acceptance_overlay/manifest.ts`, and on
 * 22.18.0 the same tree composes.
 *
 * ## Where the number lives — once
 *
 * The workspace root manifest's `engines.node` is the estate's single statement
 * of the floor: `rootNodeEngine()` in
 * `backend/scripts/lib/module-package-manifest.ts` reads it, **throws** when it
 * is absent, and propagates it to every generated module package, and
 * `instance-repository.md` R2.3 makes a scaffolded instance re-declare the
 * CLI's. This file adds no second number. It reconciles the two populations
 * nothing else reconciles against that one — the hand-written manifests and
 * `.gitlab-ci.yml`'s image tags — because a floor that CI runs below is a floor
 * that is measured nowhere, which is exactly how A8 came to be green on a
 * developer's Node and unrunnable in the pipeline.
 *
 * Whether the image tags should become one derived value is a D-100 question
 * D-236 names and does not answer; this file refuses a disagreement and
 * generates nothing.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseVersion(text: string): Version | null {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
  };
}

function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function show(version: Version): string {
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
}

/** Every path `git ls-files` tracks that is a `package.json`. */
function trackedManifests(): readonly string[] {
  const listed = spawnSync('git', ['ls-files', '*package.json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (listed.status !== 0) {
    throw new Error(
      `git ls-files exited ${String(listed.status)}: ${listed.stderr ?? ''}. Without it this ` +
        'file would report a verdict over a population it could not get.',
    );
  }
  return listed.stdout.split('\n').filter((line) => line.length > 0);
}

function declaredFloor(manifestPath: string): string | null {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, manifestPath), 'utf8')) as {
    engines?: { node?: unknown };
  };
  const node = manifest.engines?.node;
  return typeof node === 'string' && node.length > 0 ? node : null;
}

const ROOT_FLOOR_TEXT = declaredFloor('package.json');
const ROOT_FLOOR = ROOT_FLOOR_TEXT === null ? null : parseVersion(ROOT_FLOOR_TEXT);

const scratch = mkdtempSync(join(tmpdir(), 'endora-node-floor-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the Node floor buys unflagged type stripping (D-236)', () => {
  it('imports a `.ts` module with no flag, the way the overlay loader does', () => {
    const unit = join(scratch, 'overlay-unit.ts');
    writeFileSync(
      unit,
      'interface Manifest { readonly id: string }\n' +
        "export const manifest: Manifest = { id: 'overlay' };\n",
    );
    const entry = join(scratch, 'load.mjs');
    writeFileSync(
      entry,
      `const mod = await import(${JSON.stringify(`file://${unit}`)});\n` +
        'process.stdout.write(mod.manifest.id);\n',
    );
    // A child process, because this test runs under vitest and vitest's own
    // loader would answer for `.ts` whatever the runtime does — which is the
    // shape of the measurement this whole file exists to refuse.
    const ran = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
    expect(
      `${ran.stdout ?? ''}${ran.stderr ?? ''}`,
      `node ${process.versions.node} cannot import a client's overlay module. A deployment's ` +
        'overlay module is TypeScript that nothing in a scaffolded instance compiles, so the ' +
        'runtime has to strip types unasked. Raise this job\'s image to the floor the root ' +
        `manifest declares (${ROOT_FLOOR_TEXT ?? 'unset'}).`,
    ).toContain('overlay');
    expect(ran.status).toBe(0);
  });

  it('is the running runtime\'s own floor, so a green here is a green about this job', () => {
    expect(ROOT_FLOOR, 'the workspace root declares no `engines.node`').not.toBeNull();
    const running = parseVersion(process.versions.node);
    expect(running).not.toBeNull();
    expect(
      compare(running!, ROOT_FLOOR!),
      `this runtime is node ${process.versions.node} and the estate's floor is ` +
        `${ROOT_FLOOR_TEXT ?? 'unset'}. A suite run below the floor measures a runtime no ` +
        'deployment is allowed to use.',
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('nothing in the tree declares a floor below the root manifest\'s', () => {
  it('holds for every tracked manifest that declares one', () => {
    expect(ROOT_FLOOR).not.toBeNull();
    const below: string[] = [];
    for (const path of trackedManifests()) {
      const text = declaredFloor(path);
      if (text === null) continue;
      const floor = parseVersion(text);
      if (floor === null || compare(floor, ROOT_FLOOR!) < 0) below.push(`${path} -> ${text}`);
    }
    expect(
      below,
      'a manifest below the root floor admits a runtime the estate has ruled out, and nothing ' +
        'else in the tree reconciles these two values. The root manifest is the single ' +
        `statement of the floor (${ROOT_FLOOR_TEXT ?? 'unset'}); move these to it.`,
    ).toEqual([]);
  });
});

describe('the pipeline runs on an image at or above the floor (FR-011b)', () => {
  it('holds for every node image `.gitlab-ci.yml` names', () => {
    expect(ROOT_FLOOR).not.toBeNull();
    const ci = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');
    // `image:` declarations only, and deliberately: the file also carries two
    // measurement records that name the image a number was bracketed on
    // (`node:22.17-slim`, the heap bracket of pipeline 12269). Those are true
    // about the past and moving them to make this test green would falsify the
    // record. What decides what runs is the `image:` key.
    const tags = [...ci.matchAll(/^\s*image:\s*node:(\d+(?:\.\d+)*)-[a-z]+\s*$/gm)].map(
      (match) => match[1]!,
    );
    expect(
      tags.length,
      '`.gitlab-ci.yml` declares no node image, so this test read nothing',
    ).toBeGreaterThan(0);
    const below = [...new Set(tags)].filter((tag) => {
      const version = parseVersion(tag);
      // A tag naming only the major (`node:22-slim`) resolves to the line's
      // latest and is therefore at or above any floor in that major; it is
      // below the floor only when its major is.
      if (version === null) return true;
      const digits = tag.split('.').length;
      if (digits === 1) return version.major < ROOT_FLOOR!.major;
      return compare(version, ROOT_FLOOR!) < 0;
    });
    expect(
      below,
      `these image tags are below the floor the root manifest declares (${ROOT_FLOOR_TEXT ?? 'unset'}). ` +
        'A job below it cannot import a client\'s overlay module at all, so `acceptance:instance` ' +
        'A8 would be green on a developer\'s Node and unrunnable in the pipeline — which is the ' +
        `finding D-236 was written from. Floor: ${ROOT_FLOOR === null ? 'unset' : show(ROOT_FLOOR)}.`,
    ).toEqual([]);
  });
});
