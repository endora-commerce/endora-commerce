import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The boot gate's judgement, proven able to go red (feature 080, D-165 step F).
 *
 * `scripts/boot-gate.sh` builds the backend image, migrates a throwaway
 * database, boots it and asserts the compiled application is what the source
 * says. It is the condition of D-165 rather than a follow-up, because two
 * defects were **reproduced** on the half-built compiled path and neither is
 * visible to anything else in this repository: 45 of 45 modules installing no
 * translations while the boot reported `installed=0 skipped=21 failed=0`, and
 * every overlay module vanishing with no error at all.
 *
 * A boot gate that has never been red is a boot gate nobody has tested, and it
 * is red in two places on purpose. The CI job runs the gate `--with-negatives`,
 * which derives two images from the one under test — one with every `i18n`
 * directory removed from the built tree, one with the deployment's overlay
 * directory removed — boots each and requires the matching finding; that is the
 * proof over the real mechanism. This file is the other half: one red proof per
 * finding the gate claims to make, entering at the **top** of the analysis
 * (fixture text, exactly the three observations a real run collects) rather
 * than at a value the gate normally computes. A fixture that enters below the
 * defect cannot catch it (issue #130).
 *
 * The judgement is spawned rather than imported, in the idiom
 * `shell-checks.test.ts` uses: it is shell because the gate runs on `docker:27`,
 * an alpine image whose whole toolbox is busybox plus the docker client, and a
 * gate that needs a package installed before it can judge is a gate that
 * reports "could not run" on the day it matters.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LIB = join(REPO_ROOT, 'scripts/lib/boot-gate-assert.sh');

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'boot-gate-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** Writes a fixture file into the case's temp directory and returns its path. */
function fixture(name: string, contents: string): string {
  const path = join(work, name);
  writeFileSync(path, contents);
  return path;
}

/** Sources the real library and runs one of its functions, exactly as the gate does. */
function judge(snippet: string): string[] {
  const result = spawnSync('bash', ['-c', `. "${LIB}"\n${snippet}`], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`the assertion library exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout.split('\n').filter((line) => line.trim() !== '');
}

/** The finding kind, which is the part a caller matches on. */
function kinds(findings: readonly string[]): string[] {
  return findings.map((line) => line.split(':')[0]!);
}

// ---------------------------------------------------------------------------
// The observations, as a real run collects them
// ---------------------------------------------------------------------------

/**
 * A module-presence body in the shape the contract renders: the public
 * `/api/v1/storefront/module-presence` enumeration of every composed module and
 * its effective presence.
 */
function presenceBody(modules: ReadonlyArray<readonly [string, boolean]>): string {
  const entries = modules.map(([id, present]) => `{"id":"${id}","present":${present}}`);
  return `{"modules":[${entries.join(',')}]}`;
}

/** A boot log with the reconciler's own line in it, ANSI colouring included. */
function bootLog(installed: number, skipped: number, failed: number): string {
  return [
    '{"level":"info","msg":"tenant.escape_hatch","scope":"system","reason":"boot: load module presence"}',
    `[04:09:30.616] [32mINFO[39m: [36m[i18n] reconcile complete — installed=${installed} skipped=${skipped} failed=${failed}[39m`,
    '[04:09:31.291] INFO: backend listening',
    '',
  ].join('\n');
}

const SIXTY_SEVEN = Array.from({ length: 67 }, (_, i) => [`module_${i}`, true] as const);

describe('the boot gate reads the three observations a real run collects', () => {
  it('takes the module ids out of the presence body, in order', () => {
    const path = fixture(
      'presence.json',
      presenceBody([
        ['catalog', true],
        ['ksef', false],
        ['example_overlay', true],
      ]),
    );
    expect(judge(`boot_gate_module_ids "${path}"`)).toEqual(['catalog', 'ksef', 'example_overlay']);
  });

  it('separates composed from present, because a switched-off module is not a vanished one', () => {
    const path = fixture(
      'presence.json',
      presenceBody([
        ['catalog', true],
        ['ksef', false],
      ]),
    );
    expect(judge(`boot_gate_present_module_ids "${path}"`)).toEqual(['catalog']);
  });

  it('reads the reconcile line through the log colouring', () => {
    const path = fixture('boot.log', bootLog(45, 22, 0));
    const line = judge(`boot_gate_reconcile_line "${path}"`).join('');
    expect(line).toContain('installed=45 skipped=22 failed=0');
    expect(line).not.toContain('[');
  });

  it('takes the last reconcile line, not the first — the admin reload route runs the same pass', () => {
    const path = fixture('boot.log', `${bootLog(45, 22, 0)}${bootLog(1, 66, 0)}`);
    expect(judge(`boot_gate_reconcile_line "${path}"`).join('')).toContain('installed=1 skipped=66');
  });
});

describe('translations — D-165.3 first silence', () => {
  it('says nothing when every composed module is accounted for', () => {
    const path = fixture('boot.log', bootLog(45, 22, 0));
    expect(judge(`boot_gate_translation_findings "${path}" 67`)).toEqual([]);
  });

  it('reports the reproduced silence itself: installed=0 with a green failed count', () => {
    const path = fixture('boot.log', bootLog(0, 21, 0));
    const findings = judge(`boot_gate_translation_findings "${path}" 45`);
    expect(kinds(findings)).toEqual(['no-translations-installed']);
    expect(findings[0]).toContain('installed=0 skipped=21 failed=0');
  });

  it('reports a shortfall that `installed > 0` alone would miss, and names its size', () => {
    // What removing every `i18n` directory from the built tree actually produces:
    // the module packages carry their bundles inside `node_modules` and still
    // install, so the count is non-zero and 39 modules are silently unaccounted.
    const path = fixture('boot.log', bootLog(6, 22, 0));
    const findings = judge(`boot_gate_translation_findings "${path}" 67`);
    expect(kinds(findings)).toEqual(['unaccounted-modules']);
    expect(findings[0]).toContain('39');
    expect(findings[0]).toContain('copy-runtime-assets');
  });

  it('reports a reconcile that ran and failed, and a failure is accounted for', () => {
    const path = fixture('boot.log', bootLog(44, 22, 1));
    const findings = judge(`boot_gate_translation_findings "${path}" 67`);
    expect(kinds(findings)).toEqual(['translation-failures']);
  });

  it('counts a failure as accounted for, so the arithmetic reports it once and not twice', () => {
    // 44 + 22 + 1 = 67. A module whose bundle would not load is a module the
    // reconciler *did* walk and *did* report; the shortfall finding is for the
    // one case nothing reports, which is a bundle absent from the built tree.
    const path = fixture('boot.log', bootLog(44, 22, 1));
    expect(judge(`boot_gate_translation_findings "${path}" 67`)).toHaveLength(1);
  });

  it('reports a boot whose log carries no reconcile line at all', () => {
    const path = fixture('boot.log', '[04:09:31.291] INFO: backend listening\n');
    expect(kinds(judge(`boot_gate_translation_findings "${path}" 67`))).toEqual(['no-reconcile-line']);
  });

  it('reports a reconcile line it cannot read rather than treating it as agreement', () => {
    const path = fixture('boot.log', '[i18n] reconcile complete — installed=all of them\n');
    expect(kinds(judge(`boot_gate_translation_findings "${path}" 67`))).toEqual(['no-reconcile-line']);
  });
});

describe('overlays — D-165.3 second silence', () => {
  it('says nothing when the deployment gets its overlay module', () => {
    const path = fixture('presence.json', presenceBody([...SIXTY_SEVEN, ['example_overlay', true]]));
    expect(judge(`boot_gate_overlay_findings "${path}" example_overlay`)).toEqual([]);
  });

  it('names the module that vanished, and how many the platform did compose', () => {
    const path = fixture('presence.json', presenceBody(SIXTY_SEVEN));
    const findings = judge(`boot_gate_overlay_findings "${path}" example_overlay`);
    expect(kinds(findings)).toEqual(['overlay-missing']);
    expect(findings[0]).toContain('example_overlay');
    expect(findings[0]).toContain('67');
  });

  it('distinguishes a vanished overlay from one an operator switched off', () => {
    const path = fixture('presence.json', presenceBody([...SIXTY_SEVEN, ['example_overlay', false]]));
    expect(kinds(judge(`boot_gate_overlay_findings "${path}" example_overlay`))).toEqual([
      'overlay-not-present',
    ]);
  });

  it('answers for every declared module, not the first one it finds', () => {
    const path = fixture('presence.json', presenceBody([...SIXTY_SEVEN, ['example_overlay', true]]));
    const findings = judge(`boot_gate_overlay_findings "${path}" example_overlay second_overlay`);
    expect(kinds(findings)).toEqual(['overlay-missing']);
    expect(findings[0]).toContain('second_overlay');
  });

  it('does not match an id by prefix — `blog` is not `blog_comments`', () => {
    const path = fixture('presence.json', presenceBody([['blog_comments', true]]));
    expect(kinds(judge(`boot_gate_overlay_findings "${path}" blog`))).toEqual(['overlay-missing']);
  });
});

describe('health', () => {
  it('says nothing on 200', () => {
    expect(judge('boot_gate_health_findings 200')).toEqual([]);
  });

  it('reports the status, and says that nothing below it was measured', () => {
    const findings = judge('boot_gate_health_findings 503');
    expect(kinds(findings)).toEqual(['unhealthy']);
    expect(findings[0]).toContain('503');
  });

  it('reports a request that never connected the same way', () => {
    expect(kinds(judge('boot_gate_health_findings 000'))).toEqual(['unhealthy']);
  });
});

describe('the gate itself', () => {
  it('refuses a deployment with no overlay module rather than passing over an empty population', () => {
    const result = spawnSync(
      'bash',
      [join(REPO_ROOT, 'scripts/boot-gate.sh'), '--deployment', 'no-such-deployment'],
      { encoding: 'utf8', cwd: REPO_ROOT },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('declares no overlay module');
  });

  it('is run by CI with its own red proof, which is the half that can be dropped silently', () => {
    // The positive run goes red when the image is broken; the negative runs go
    // red when the *gate* is broken, and only one of those two failures announces
    // itself. Dropping `--with-negatives` leaves a job that still passes on every
    // pipeline and has stopped proving anything, so the flag is asserted here
    // rather than left to a reviewer noticing its absence in a YAML diff.
    const ci = spawnSync('cat', [join(REPO_ROOT, '.gitlab-ci.yml')], { encoding: 'utf8' }).stdout;
    // The invocation, not the `changes:` entry that names the same path and not
    // the prose above the job.
    const invocation = ci
      .split('\n')
      .filter((line) => /^\s*-\s+bash\s+scripts\/boot-gate\.sh\b/.test(line));
    expect(invocation).toHaveLength(1);
    expect(invocation[0]).toContain('--with-negatives');
  });

  it('reads the expected overlay ids off the deployment directory rather than a list', () => {
    // The gate's own derivation, asserted here because it is the one input a
    // written-down copy would silently freeze (D-100): a deployment that grows a
    // second overlay module must be covered by existing.
    const source = spawnSync('cat', [join(REPO_ROOT, 'scripts/boot-gate.sh')], {
      encoding: 'utf8',
    }).stdout;
    expect(source).toContain('backend/src/apps/$DEPLOYMENT/modules');
    expect(source).not.toContain('EXPECTED_OVERLAYS="example_overlay"');
  });
});
