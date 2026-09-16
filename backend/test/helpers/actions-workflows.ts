/**
 * `.github/workflows/*.yml`, read as jobs and as the commands they run.
 *
 * The GitLab twin of this file is `ci-jobs.ts` beside it, and the relationship
 * between them is deliberate rather than accidental duplication. `ci-jobs.ts`'
 * own header refuses *"two parsers over one file"*, and window §4.6 extends that
 * to the migration: when GitLab jobs start being removed, `readJobs()` gains a
 * second **source** so its callers keep asking one question — *does any job, on
 * either host, run this* — over one union.
 *
 * This reader is not that second source and must not become it. It exists for
 * the opposite question, which only makes sense while both hosts carry the same
 * jobs: **are the two lists equal**. Two formats, two readers, one comparison
 * (`test/unit/ci/actions-floor-parity.test.ts`). When T044 arrives and the union
 * is built, the union's reader is `readJobs()`, and this one keeps doing parity
 * for whatever has not been removed yet.
 *
 * Deliberately not a YAML parser, for the same reason as `ci-jobs.ts`: this
 * repository has no YAML dependency and Constitution IV says the default answer
 * to a new one is no. The workflow files are written to a fixed two-space shape
 * and the floors in the caller are what make that choice safe — a parse that
 * stops working fails rather than reporting an empty population.
 */

/** One job of a workflow, as raw text and as the commands its steps run. */
export interface WorkflowJob {
  /** The YAML key under `jobs:` — no colon is allowed in it. */
  readonly id: string;
  /**
   * The job's `name:`, which is what a required status check is listed by and
   * therefore what carries the GitLab job's name across.
   */
  readonly name: string | null;
  /** Every line of the job's own block. */
  readonly body: string;
  /** Every command line of every `run:` step, in order, comments dropped. */
  readonly runLines: readonly string[];
  /** Every `uses:` value the job names, in order. */
  readonly uses: readonly string[];
}

const INDENT = /^(\s*)/;

function indentOf(line: string): number {
  return INDENT.exec(line)![1]!.length;
}

function isSkippable(line: string): boolean {
  return line.trim() === '' || line.trim().startsWith('#');
}

/**
 * The command lines of one job block.
 *
 * A step's command is either `run: <command>` on one line or `run: |` opening a
 * block scalar. The block ends at the first non-blank, non-comment line indented
 * no further than the `run:` key itself — which is why the key's own column is
 * measured rather than assumed.
 */
function runLinesOf(body: readonly string[]): string[] {
  const commands: string[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const line = body[index]!;
    const match = /^(\s*)(?:- )?run:(.*)$/.exec(line);
    if (match === null) continue;
    const column = line.indexOf('run:');
    const inline = match[2]!.trim();
    if (inline !== '' && inline !== '|' && inline !== '|-' && inline !== '>') {
      commands.push(inline);
      continue;
    }
    for (let next = index + 1; next < body.length; next += 1) {
      const candidate = body[next]!;
      if (isSkippable(candidate)) continue;
      if (indentOf(candidate) <= column) break;
      commands.push(candidate.trim());
    }
  }
  return commands;
}

/**
 * The jobs of one workflow file.
 *
 * `jobs:` at column 0 opens the section; a two-space key inside it opens a job;
 * any column-0 content ends the section.
 */
export function readWorkflowJobs(source: string): readonly WorkflowJob[] {
  const lines = source.split('\n');
  const jobs: WorkflowJob[] = [];

  let inJobs = false;
  let id: string | null = null;
  let body: string[] = [];

  const flush = (): void => {
    if (id !== null) {
      const name = /^\s{4}name:\s*(.+)$/m.exec(body.join('\n'));
      jobs.push({
        id,
        name: name === null ? null : name[1]!.trim(),
        body: body.join('\n'),
        uses: [...body.join('\n').matchAll(/^\s*(?:- )?uses:\s*(\S+)\s*$/gm)].map(
          (match) => match[1]!,
        ),
        runLines: runLinesOf(body),
      });
    }
    id = null;
    body = [];
  };

  for (const line of lines) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) inJobs = true;
      continue;
    }
    if (!isSkippable(line) && indentOf(line) === 0) {
      flush();
      inJobs = false;
      continue;
    }
    const opener = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (opener !== null) {
      flush();
      id = opener[1]!;
      continue;
    }
    if (id === null) continue;
    body.push(line);
  }
  flush();
  return jobs;
}

/**
 * The lines of a script that invoke this repository's own gate machinery.
 *
 * This is the whole of the parity comparison's definition, and it is one
 * predicate applied to **both** hosts rather than a per-host allow-list. A
 * gate is invoked either through the package manager or by running a script in
 * `scripts/` directly; everything else in either job — `apt-get`, GitLab's
 * `safe.directory`, `corepack`, the store-path probe, the shell that resolves a
 * base ref — is the host supplying an environment, and differs by construction.
 *
 * Keeping the drop side implicit is what makes the comparison honest: there is
 * no list anybody can extend to make a divergence disappear.
 */
export function gateCommands(script: string): readonly string[] {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => (line.startsWith('- ') ? line.slice(2).trim() : line))
    .filter((line) => /^(pnpm\s|bash scripts\/)/.test(line));
}
