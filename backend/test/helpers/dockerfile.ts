/**
 * Reading a Dockerfile: stages, and the `COPY` instructions inside them.
 *
 * It lived inside `test/unit/ci/dockerfile-workspace-supply.test.ts` until a
 * second reader existed. Two parsers over one file would be one population
 * derived twice, which is the shape this estate spends its review effort
 * refusing — the same move `test/helpers/ci-jobs.ts` made when
 * `gate-coverage.test.ts` became `toolchain-supply.test.ts`'s neighbour.
 *
 * It is a *reader*, not a builder: it knows nothing about what an instruction
 * means, and every rule stated over it lives in the test that asks it. What it
 * cannot see, stated here rather than discovered later:
 *
 *   * heredocs (`RUN <<EOF`), which read as ordinary instruction text;
 *   * `ARG` substitution — `COPY $SOMETHING x` yields the literal `$SOMETHING`;
 *   * `.dockerignore`, which can remove a path a `COPY` names; and
 *   * a `FROM` naming a stage declared *after* it, which docker rejects anyway.
 */

/** One instruction, with any line continuations already joined. */
export interface DockerInstruction {
  readonly keyword: string;
  /** Everything after the keyword. */
  readonly rest: string;
}

/** One `FROM … [AS <name>]` block and the instructions under it. */
export interface DockerStage {
  readonly name: string | null;
  /** The image or stage this one is built `FROM`. */
  readonly base: string | null;
  readonly instructions: readonly DockerInstruction[];
}

/** The instructions of a Dockerfile, grouped by the stage that runs them. */
export function readStages(source: string): readonly DockerStage[] {
  const joined: DockerInstruction[] = [];
  let pending = '';
  for (const raw of source.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*#/.test(line) && pending === '') continue;
    const continued = /\\\s*$/.test(line);
    pending += (pending === '' ? '' : ' ') + line.replace(/\\\s*$/, '').trim();
    if (continued) continue;
    const statement = pending.trim();
    pending = '';
    if (statement === '') continue;
    const head = /^(\w+)\s+([\s\S]*)$/.exec(statement);
    if (head === null) continue;
    joined.push({ keyword: head[1]!.toUpperCase(), rest: head[2]!.trim() });
  }

  const stages: DockerStage[] = [];
  let current: DockerInstruction[] = [];
  let name: string | null = null;
  let base: string | null = null;
  let opened = false;
  const flush = (): void => {
    if (opened) stages.push({ name, base, instructions: current });
    current = [];
    name = null;
    base = null;
  };
  for (const instruction of joined) {
    if (instruction.keyword === 'FROM') {
      flush();
      opened = true;
      const alias = /\sAS\s+(\S+)\s*$/i.exec(` ${instruction.rest}`);
      name = alias === null ? null : alias[1]!;
      const positional = instruction.rest
        .split(/\s+/)
        .filter((token) => token !== '' && !token.startsWith('--'));
      base = positional[0] ?? null;
      continue;
    }
    if (opened) current.push(instruction);
  }
  flush();
  return stages;
}

/** A `COPY`, split into its flags, its sources and its destination. */
export interface DockerCopy {
  /** The stage named by `--from=`, or `null` for a copy out of the build context. */
  readonly fromStage: string | null;
  readonly sources: readonly string[];
  /** The last positional token, or `null` when there is only one. */
  readonly destination: string | null;
}

/** Read one instruction as a `COPY`, or `null` when it is not one. */
export function readCopy(instruction: DockerInstruction): DockerCopy | null {
  if (instruction.keyword !== 'COPY') return null;
  const tokens = instruction.rest.split(/\s+/).filter((token) => token !== '');
  let fromStage: string | null = null;
  const positional: string[] = [];
  for (const token of tokens) {
    const flag = /^--from=(.+)$/.exec(token);
    if (flag !== null) {
      fromStage = flag[1]!;
      continue;
    }
    if (token.startsWith('--')) continue;
    positional.push(token.replace(/^"|"$/g, ''));
  }
  // The last positional is the destination.
  return {
    fromStage,
    sources: positional.slice(0, -1),
    destination: positional.length > 1 ? positional[positional.length - 1]! : null,
  };
}
