import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * The external programs this suite spawns, asked for by name, once.
 *
 * Pipeline 11475's `test:backend:unit` reported twenty-two assertion failures
 * across five files. Ten of them were `expected 1 to be 0`, two were "printed
 * no read line", eight were `changeset version` exiting 1 — and every one of
 * them had the same cause, which none of them said: **`node:22.17-slim` ships
 * no git**. The suite spawns it three ways and never by that name, so the
 * message a reader needed was not in the log:
 *
 *   - `test/unit/release/changeset-flow.test.ts` runs the real changesets CLI,
 *     which shells out to git to attribute a changeset to a commit;
 *   - `test/unit/scripts/check-read-size.test.ts` spawns `check-naming.sh` and
 *     `check-language.sh` over the real tree, and their file list is
 *     `git ls-files` — without it they exit 2 by design, rather than report a
 *     vacuous green over an empty list;
 *   - `test/helpers/shell-check-fixture.ts` fakes git for the *fixture* runs,
 *     which is why `shell-checks.test.ts` is unaffected and why the fixture is
 *     not evidence that the suite needs none.
 *
 * So the requirement is asserted here rather than written into a job list in
 * `.gitlab-ci.yml` or into a test that reads it (D-100 — a derived fact copied
 * into a second place). Any job that runs this suite gets the answer, in one
 * sentence, before the twenty-two consequences of the same absence.
 *
 * `test/release/changeset-gate.test.ts` makes the same assertion for the
 * release-gate suite, and did so first; this is that idea applied to the suite
 * where the absence actually cost a day.
 */

function probe(program: string, args: readonly string[]): { ok: boolean; detail: string } {
  const result = spawnSync(program, [...args], { encoding: 'utf8' });
  if (result.error !== undefined) return { ok: false, detail: String(result.error) };
  return {
    ok: result.status === 0,
    detail: `exit ${String(result.status)}: ${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('the programs this suite spawns are on PATH', () => {
  it('git — the changesets CLI and both shell checks read the tree through it', () => {
    const seen = probe('git', ['--version']);
    expect(
      seen.ok,
      'no usable git. `node:22.17-slim` ships none, so a CI job running this suite has to ' +
        'install it; `test:backend:unit` is the job. Without it `changeset version` exits 1 on ' +
        '`spawn git ENOENT`, and check-naming.sh / check-language.sh exit 2 refusing to report ' +
        `a verdict over a file list they could not get. ${seen.detail}`,
    ).toBe(true);
  });

  it('perl — the prose scan in check-language.sh, spawned by check-read-size', () => {
    const seen = probe('perl', ['-e', 'print "ok"']);
    expect(seen.ok, `no usable perl. ${seen.detail}`).toBe(true);
  });

  /**
   * The capability, not the binary — this is the second half of the same
   * pipeline's failure and the half a `command -v perl` guard cannot see.
   *
   * `perl-base` is Essential and is the only perl in either CI image; the
   * modules split lives in `perl-modules`, so `PerlIO.pm` and every
   * `:encoding(...)` layer are absent until something drags it in. Both jobs
   * that were green got it from `apt-get install git`, which depends on it —
   * a supply nothing declared. The scanner in `check-language.sh` was rewritten
   * to encode its own output with core `utf8::encode` precisely so that this
   * assertion can be about the floor rather than about an installed package,
   * and this is the assertion that keeps it there: a scanner that goes back to
   * a layer fails here on a `perl-base` image, and this one is the message.
   */
  it('perl needs nothing outside its core to run the prose scan', () => {
    const seen = probe('perl', [
      '-CA',
      '-e',
      'binmode(STDOUT, ":raw"); my $s = "\\x{2717}\\x{142}"; utf8::encode($s); print $s;',
    ]);
    expect(
      seen.ok,
      `the core-only encoding path does not work on this perl. ${seen.detail}`,
    ).toBe(true);
  });
});
