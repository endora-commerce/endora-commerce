import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `check:block-names` over the real tree **with `ksef` absent** —
 * `specs/134-paid-module-extraction/` T063, the deliverable of the
 * `ksef.InvoiceSection` repair (O-3, exit E4; `spec.md` §11.3.2).
 *
 * **Absent, not switched off.** The check reads manifests and sources, not
 * presence, so a switched-off `ksef` is invisible to it: its manifest still
 * declares `ksef.InvoiceSection` and the check stays green whatever the free
 * tree does with that name. That is how the inversion survived — the check was
 * green because both halves were installed, which reads exactly like a sound
 * design. `--absent ksef` takes the module's manifest out of the declarations
 * and its sources out of both walks, which is the tree a free instance has.
 *
 * **What makes the green structural.** Before the repair, free `invoices`
 * seeded the block (a tree site) and bound its React preview (a renderer-map
 * site), so this run was red on finding 6 — `renderer-without-declaration` —
 * and on finding 2 for the seed. After it, every use of the name is `ksef`'s
 * own, so removing `ksef` removes the declaration and every use together:
 * `declared=` and `rendered=` both drop by exactly one from the present tree's
 * count, and nothing is left naming what nothing declares.
 *
 * The present-tree run is asserted beside it so the two numbers are measured
 * in one place rather than one of them trusted from a recorded line. Both are
 * derived from the run, not written down: the assertion is the *difference*,
 * which is the property; the absolute counts move whenever a module declares a
 * block.
 *
 * The same shape is what `contracts/extraction-procedure.md` W6 and T038 ask of
 * every later wave: run the declaration checks with the departing module
 * removed, not only with it present.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');

interface BlockNamesRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly declared: number;
  readonly rendered: number;
  readonly findings: number;
}

function runBlockNames(args: readonly string[]): BlockNamesRun {
  const run = spawnSync(
    join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx'),
    [join(BACKEND_ROOT, 'scripts', 'check-block-names.ts'), ...args],
    { cwd: BACKEND_ROOT, encoding: 'utf8', env: { ...process.env } },
  );
  const summary = /declared=(\d+) rendered=(\d+) .* findings=(\d+)/.exec(run.stdout);
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    declared: summary ? Number(summary[1]) : Number.NaN,
    rendered: summary ? Number(summary[2]) : Number.NaN,
    findings: summary ? Number(summary[3]) : Number.NaN,
  };
}

describe('check:block-names with ksef absent (134 T063)', () => {
  it('is green with ksef present and green with it absent, one block fewer on each side', () => {
    const present = runBlockNames([]);
    expect(present.stderr, present.stdout).toBe('');
    expect(present.status).toBe(0);
    expect(present.findings).toBe(0);
    expect(present.declared).toBe(present.rendered);

    const absent = runBlockNames(['--absent', 'ksef']);
    // Finding 6 (and 2, for the seed) is what this run printed before the
    // repair; the stderr assertion is what shows it, by kind and site.
    expect(absent.stderr, absent.stdout).not.toMatch(/renderer-without-declaration/);
    expect(absent.stderr, absent.stdout).not.toMatch(/undeclared-block-name/);
    expect(absent.stderr, absent.stdout).toBe('');
    expect(absent.status).toBe(0);
    expect(absent.findings).toBe(0);
    expect(absent.declared).toBe(present.declared - 1);
    expect(absent.rendered).toBe(present.rendered - 1);
    expect(absent.stdout).toContain('absent=ksef');
  }, 120_000);
});
