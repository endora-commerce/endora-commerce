/**
 * `.gitlab-ci.yml`, read as jobs and as the commands they run.
 *
 * Two tests ask questions of this file — `test/unit/ci/toolchain-supply.test.ts`
 * ("does the job's environment supply what its script needs") and
 * `test/unit/ci/gate-coverage.test.ts` ("does any job run this gate at all") —
 * and both need the same thing first: which lines sit under which key. Two
 * parsers over one file would be one population derived twice, which is the
 * shape this estate spends its review effort refusing, so there is one here and
 * both import it.
 *
 * Deliberately not a YAML parser: this repository has no YAML dependency and
 * Constitution IV says the default answer to a new one is no. The file is
 * indented two spaces throughout, and the floors in both callers are what make
 * that choice safe — a parse that stops working fails rather than reporting an
 * empty population.
 */

/** One job of the pipeline, as raw text under each of its keys. */
export interface CiJob {
  readonly name: string;
  /** Everything under `before_script:`, as raw text. */
  readonly beforeScript: string;
  /** Everything under `script:`, as raw text — block scalars included. */
  readonly script: string;
  /** Every line of the job's own block, so a top-level job key can be read. */
  readonly body: string;
}

/**
 * The jobs, read out of the file directly.
 *
 * A top-level `name:` line opens a block; any other column-0 content closes it
 * (a comment, a blank line and an indented line all continue it). Within a
 * block, a two-space key selects the section the following lines belong to.
 */
export function readJobs(source: string): readonly CiJob[] {
  const lines = source.split('\n');
  const jobs: CiJob[] = [];

  let name: string | null = null;
  let section: 'before_script' | 'script' | null = null;
  let before: string[] = [];
  let script: string[] = [];
  let body: string[] = [];

  const flush = (): void => {
    if (name !== null) {
      jobs.push({
        name,
        beforeScript: before.join('\n'),
        script: script.join('\n'),
        body: body.join('\n'),
      });
    }
    name = null;
    section = null;
    before = [];
    script = [];
    body = [];
  };

  for (const line of lines) {
    const top = /^([A-Za-z][\w:.-]*):\s*$/.exec(line);
    if (top !== null) {
      flush();
      name = top[1]!;
      continue;
    }
    if (line !== '' && !/^\s/.test(line) && !line.startsWith('#')) {
      flush();
      continue;
    }
    if (name === null) continue;
    body.push(line);

    const key = /^ {2}([a-z_]+):/.exec(line);
    if (key !== null) {
      section = key[1] === 'before_script' || key[1] === 'script' ? key[1] : null;
      continue;
    }
    if (section === 'before_script') before.push(line);
    if (section === 'script') script.push(line);
  }
  flush();
  return jobs;
}

/**
 * Every command line the pipeline executes, comments dropped.
 *
 * The comment half is load-bearing rather than tidiness: the prose in this file
 * names half the estate by script name, so a corpus that kept it would report
 * every mentioned rule as run. `check-inventory.test.ts` learned that the hard
 * way — the paragraph above `quality:static` made `check:naming` look like part
 * of the `quality` job.
 */
export function commandLines(jobs: readonly CiJob[]): readonly string[] {
  return jobs
    .flatMap((job) => [...job.beforeScript.split('\n'), ...job.script.split('\n')])
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
}
