import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `check:block-names` over the real tree **with a module absent** —
 * `specs/134-paid-module-extraction/` T063, and the shape W6 and T038 ask of
 * every wave: run the declaration checks with the departing module removed,
 * not only with it present.
 *
 * **Absent, not switched off.** The check reads manifests and sources, not
 * presence, so a switched-off module is invisible to it: its manifest still
 * declares its blocks and the check stays green whatever the rest of the tree
 * does with those names. `--absent <id>` takes the module's manifest out of the
 * declarations and its sources out of both walks, which is the tree a
 * deployment without it has.
 *
 * **What makes the green structural.** A module whose every block is used only
 * by itself leaves the tree green when it goes: `declared=` and `rendered=` drop
 * by the same count, and nothing is left naming what nothing declares. If a
 * free module still seeded, rendered or bound one of its names, this run would
 * be red on finding 6 — `renderer-without-declaration` — or finding 2.
 *
 * ## The subject was `ksef`, and it left
 *
 * T063 wrote this over `ksef.InvoiceSection`, the block free `invoices` used to
 * seed, render, describe and bind while `ksef` declared it: red before the
 * repair, green after, one block fewer on each side. `ksef` then left this
 * repository (T069), and the real tree is now the tree `--absent ksef`
 * described — which the present-tree run below asserts green, with every
 * `ksef.` name gone from both walks. The flag keeps a subject that stays:
 * `invoices`, the other module in that repair, whose ten blocks are declared,
 * seeded, rendered and bound by nobody but itself. Recovery of the original:
 * `git show f75de58e9:backend/test/unit/scripts/check-block-names-absent.test.ts`.
 *
 * The present-tree run is asserted beside it so the two numbers are measured
 * in one place rather than one of them trusted from a recorded line. Both are
 * derived from the run, not written down: the assertion is the *difference*,
 * which is the property; the absolute counts move whenever a module declares a
 * block.
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

describe('check:block-names with a module absent (134 T063)', () => {
  it('is green with invoices present and green with it absent, its blocks fewer on each side', () => {
    const present = runBlockNames([]);
    expect(present.stderr, present.stdout).toBe('');
    expect(present.status).toBe(0);
    expect(present.findings).toBe(0);
    expect(present.declared).toBe(present.rendered);

    const absent = runBlockNames(['--absent', 'invoices']);
    expect(absent.stderr, absent.stdout).not.toMatch(/renderer-without-declaration/);
    expect(absent.stderr, absent.stdout).not.toMatch(/undeclared-block-name/);
    expect(absent.stderr, absent.stdout).toBe('');
    expect(absent.status).toBe(0);
    expect(absent.findings).toBe(0);
    const removed = present.declared - absent.declared;
    expect(removed).toBeGreaterThan(0);
    expect(present.rendered - absent.rendered).toBe(removed);
    expect(absent.stdout).toContain('absent=invoices');
  }, 120_000);
});
