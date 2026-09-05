/**
 * Which of this repository's own scripts a pipeline actually runs.
 *
 * The analysis behind `test/unit/ci/gate-coverage.test.ts`. It is a separate
 * file so every red proof in that test can enter at the **top** of it — over
 * invented manifests and an invented pipeline — rather than below the
 * derivation the proof is supposed to protect (issue #130).
 *
 * Nothing here decides whether a script *should* run. It answers one question,
 * derived: given these workspace manifests and this pipeline, is there a path
 * from a job to this script? The verdicts for the ones there is no path to are
 * the test's, written down with a reason.
 */

import { basename } from 'node:path';

/** One member whose `package.json` declares scripts. */
export interface ScriptMember {
  /** The manifest's `name`; {@link ROOT_MEMBER} for the repository root. */
  readonly name: string;
  /** Directory relative to the repository root — `''` for the root. */
  readonly dir: string;
  readonly scripts: Readonly<Record<string, string>>;
}

/**
 * The repository root's stand-in name.
 *
 * The root is not a `pnpm-workspace.yaml` member and has no package `name`, but
 * it declares `check:naming`, `check:language` and `check:pdfmake-footprint` —
 * three of the estate's rules — so a population that skipped it would be blind
 * to the whole `quality:static` job.
 */
export const ROOT_MEMBER = '<root>';

/** `member::script`, the key everything below is stated in. */
export type ScriptKey = string;

export function keyOf(member: string, script: string): ScriptKey {
  return `${member}::${script}`;
}

/** A script whose command runs a file this repository wrote. */
export interface RepositoryScript {
  readonly member: string;
  /** For messages: the member's directory, or `<root>`. */
  readonly where: string;
  readonly script: string;
  /** The path the command names, as written (`scripts/…`, `../../scripts/…`). */
  readonly file: string;
  readonly key: ScriptKey;
}

/**
 * The file a command runs, when that file is one of ours.
 *
 * `tsx`, `node`, `bash` and `sh` followed by a path under a `scripts/`
 * directory — the member's own, or the root's reached with `../`. Interpreter
 * flags between the two are skipped (`node --env-file-if-exists=.env …`).
 *
 * A path that merely *contains* a `scripts/` segment is not one: the five
 * `module:*` scripts run `src/lifecycle/scripts/enable.ts`, which is
 * application code operating on a live instance, not a rule over this tree.
 */
export function repositoryScriptFile(command: string): string | null {
  const match =
    /(?:^|[|&;(]\s*|\s)(?:tsx|node|bash|sh)\s+(?:--?\S+\s+)*((?:\.\.\/)*scripts\/[\w./-]+)/.exec(
      command,
    );
  return match === null ? null : match[1]!;
}

/**
 * Every script in the workspace whose command runs a repository script file.
 *
 * **This is the population, and it is keyed on what a script *runs*, never on
 * what it is called.** That is the whole correction over
 * `check-inventory.test.ts`, whose population is `check-*.ts` files plus
 * `check:*` package scripts: `manifests:check` is a gate and is neither, so it
 * sat outside every reconciliation in the repository and ran in no job for as
 * long as it existed.
 *
 * What it deliberately leaves out is the toolchain, not a rule: a script that
 * runs the application (`src/…`), a test runner, `tsc`, `eslint` or
 * `docker compose` is not something somebody here wrote to be run over this
 * tree, and whether CI runs *those* is the `quality` and `test` stages' own
 * subject.
 */
export function repositoryScripts(members: readonly ScriptMember[]): readonly RepositoryScript[] {
  const found: RepositoryScript[] = [];
  for (const member of members) {
    for (const [script, command] of Object.entries(member.scripts)) {
      const file = repositoryScriptFile(command);
      if (file === null) continue;
      found.push({
        member: member.name,
        where: member.name === ROOT_MEMBER ? ROOT_MEMBER : member.dir,
        script,
        file,
        key: keyOf(member.name, script),
      });
    }
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does a `pnpm --filter` selector select this member?
 *
 * Three shapes, and everything else is **no**: a path glob (`./packages/**`), a
 * package name, and a directory. A selector carrying pnpm's dependency
 * operators (`...`, `^`) is refused rather than approximated — `backend^...`
 * selects backend's *dependencies* and not backend, so guessing would credit a
 * script with a run it never gets. Failing to match is the safe direction here:
 * it costs a written verdict, where a wrong match costs the whole invariant.
 */
export function selectorMatches(selector: string, member: ScriptMember): boolean {
  const cleaned = selector.replace(/^["']|["']$/g, '');
  if (/\.{3}|\^/.test(cleaned)) return false;
  if (cleaned.startsWith('./')) {
    const pattern = cleaned
      .slice(2)
      .split('/')
      .map((segment) => (segment === '**' ? '.*' : segment === '*' ? '[^/]*' : escape(segment)))
      .join('/');
    return new RegExp(`^${pattern}$`).test(member.dir);
  }
  return cleaned === member.name || cleaned === member.dir;
}

/** One `pnpm … run <script>` this text performs, resolved to the members it reaches. */
function invocationTargets(
  text: string,
  context: ScriptMember | null,
  members: readonly ScriptMember[],
  root: ScriptMember,
): readonly (readonly [ScriptMember, string])[] {
  const targets: (readonly [ScriptMember, string])[] = [];
  for (const match of text.matchAll(/pnpm\s+([^\n]*?)\brun\s+([\w:.-]+)/g)) {
    const flags = match[1]!.trim();
    const script = match[2]!;
    if (/(?:^|\s)(?:-r|--recursive)(?:\s|$)/.test(flags)) {
      for (const member of members) targets.push([member, script]);
      continue;
    }
    const filter = /--filter[= ]\s*(\S+)/.exec(flags);
    if (filter !== null) {
      for (const member of members) {
        if (selectorMatches(filter[1]!, member)) targets.push([member, script]);
      }
      continue;
    }
    // No selector: a bare `pnpm run x` inside a member's own script means that
    // member's `x`, and in the pipeline it means the root's. `storefront`'s
    // `build` reaches `check:themes` exactly this way, through the Dockerfile
    // `build:storefront` builds — three hops, no `--filter` on any of them.
    targets.push([context ?? root, script]);
  }
  return targets;
}

/** The Dockerfiles the pipeline builds, as the `docker build -f <path>` commands name them. */
export function dockerfilesBuiltBy(commands: string): readonly string[] {
  return [...commands.matchAll(/docker\s+build\s+(?:[^\n]*?\s)?-f\s+(\S+)/g)]
    .map((match) => match[1]!)
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
}

export interface CoverageInput {
  /** Every command line the pipeline's jobs run — `ci-jobs.ts`' `commandLines`. */
  readonly commands: readonly string[];
  /** Dockerfile path (as the pipeline names it) → its contents, or `null` when absent. */
  readonly dockerfile: (path: string) => string | null;
  readonly members: readonly ScriptMember[];
}

export interface Coverage {
  /** Every `member::script` a job reaches, directly or through another script. */
  readonly reached: ReadonlySet<ScriptKey>;
  /** Keys reached because the pipeline names the script *file* it runs. */
  readonly byFile: ReadonlySet<ScriptKey>;
  /** Keys reached because a command runs the script *by name*. */
  readonly byName: ReadonlySet<ScriptKey>;
  /** The pipeline's own commands plus the `RUN` lines of every Dockerfile it builds. */
  readonly corpus: string;
  readonly dockerfilesRead: readonly string[];
}

/**
 * What the pipeline runs, to a fixpoint.
 *
 * Two independent mechanisms, and the split matters:
 *
 *  - **by name**, followed transitively — a job runs a script, that script runs
 *    another, and so on. `build:storefront` → `storefront/Dockerfile` →
 *    `pnpm --filter storefront run build` → `pnpm run check:themes`.
 *  - **by file**, and *only* over the pipeline's own corpus — a job invokes the
 *    script file directly, as `quality` does for
 *    `scripts/check-channel-resolution.ts` and `quality:static` for the two
 *    shell checks.
 *
 * The second is confined to the pipeline's own text on purpose. Two package
 * scripts routinely run one file in two modes — `manifests:generate` and
 * `manifests:check` are `generate-module-manifests.ts` with and without
 * `--check` — so letting a transitively reached command contribute its file
 * name would report the generator as covered because the checker is, which is
 * precisely the pair this whole file exists to keep apart.
 */
export function pipelineCoverage(input: CoverageInput): Coverage {
  const root =
    input.members.find((member) => member.name === ROOT_MEMBER) ??
    ({ name: ROOT_MEMBER, dir: '', scripts: {} } satisfies ScriptMember);

  const pipeline = input.commands.join('\n');
  const dockerfilesRead: string[] = [];
  let corpus = pipeline;
  for (const path of dockerfilesBuiltBy(pipeline)) {
    const contents = input.dockerfile(path);
    if (contents === null) continue;
    dockerfilesRead.push(path);
    corpus += `\n${contents
      .split('\n')
      .filter((line) => /^\s*RUN\b/.test(line))
      .join('\n')}`;
  }

  const byName = new Set<ScriptKey>();
  const queue = [...invocationTargets(corpus, null, input.members, root)];
  while (queue.length > 0) {
    const [member, script] = queue.pop()!;
    const key = keyOf(member.name, script);
    if (byName.has(key)) continue;
    const body = member.scripts[script];
    if (body === undefined) continue;
    byName.add(key);
    for (const target of invocationTargets(body, member, input.members, root)) queue.push(target);
    // npm lifecycle: running `x` runs `prex` and `postx`. `storefront`'s themes
    // were wired that way before they moved into `build` itself, and a
    // derivation that could not see it would report a generator nobody runs.
    for (const hook of [`pre${script}`, `post${script}`]) {
      if (member.scripts[hook] !== undefined) queue.push([member, hook]);
    }
  }

  const byFile = new Set<ScriptKey>();
  for (const candidate of repositoryScripts(input.members)) {
    if (corpus.includes(basename(candidate.file))) byFile.add(candidate.key);
  }

  return {
    reached: new Set([...byName, ...byFile]),
    byFile,
    byName,
    corpus,
    dockerfilesRead,
  };
}
