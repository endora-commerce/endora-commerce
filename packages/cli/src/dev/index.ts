/**
 * `endora dev` — the supervisor behind an instance's `pnpm run dev:all`
 * (`specs/136-open-source-publication/spec.md` GAP-7, FR-060, FR-061;
 * research R-10).
 *
 * ## What it is, in one sentence
 *
 * One foreground process over the development commands an instance already
 * has — the API, the admin preview and, when present, the storefront — that
 * prefixes their output, stops all of them on an interrupt, and stops all of
 * them when any one of them ends, naming which.
 *
 * ## What it is not
 *
 * A fusion of the layers. D-230 deploys the backend, the admin and the
 * storefront to hosts of their own and builds each with a command of its own;
 * this changes none of those commands and none of the artefacts (FR-061). It
 * runs the **root scripts** the instance declares — `start` and
 * `preview:admin` — and the storefront's own `dev`, by name, so a change to
 * what a layer runs reaches the composite with nothing here edited. That is
 * `setup`'s derivation one level over.
 *
 * **Why the storefront runs `dev` and the other two do not.** The instance's
 * `start` and `preview:admin` serve what `setup` built, and `endora install`
 * runs `setup`. It does not build the storefront — it installs it — so the one
 * storefront command that works on a tree the install left is `next dev`. The
 * admin is the admin *preview* because FR-060 says so: the built bundle is
 * what an operator signs in to.
 *
 * ## Where the storefront is
 *
 * Its own repository (D-195), so nothing in the instance names it. The default
 * is the sibling `endora install` writes by default — `<dir>-storefront`
 * (125 FR-160) — and `--storefront-dir` names another. Absent, it is not a
 * refusal: FR-060 says *"when present"*. Named and absent, it is: the operator
 * asked for a layer that is not there.
 *
 * ## Why process groups
 *
 * The instance's own `dev` script is `tsc --watch & node --watch …`, and
 * `pnpm run` puts a shell between this process and the one doing the work.
 * Signalling the pid this process spawned reaches the shell and nothing it
 * backgrounded. Each layer is therefore spawned as the leader of a group of its
 * own and the whole group is signalled — which is also why an interrupt from
 * the terminal is received here and forwarded, rather than delivered to every
 * process at once by the terminal's own group.
 *
 * No dependency: `node:child_process` only (research R-10 rejected
 * `concurrently` and `npm-run-all` for ~60 lines the CLI already has the
 * primitives for).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { constants } from 'node:os';

/** The root script a scaffolded instance declares for this command. */
export const DEV_ALL_SCRIPT = 'dev:all';

/** A refusal the operator can act on — exit 1. */
export class DevInputError extends Error {
  override readonly name = 'DevInputError';
}

/** An input this run could not read — exit 2. */
export class DevHostError extends Error {
  override readonly name = 'DevHostError';
}

/** One layer, as the plan decides it: which script, run where. */
export interface DevLayer {
  readonly label: 'api' | 'admin' | 'storefront';
  readonly cwd: string;
  /** The package script it runs, by name — never its contents. */
  readonly script: string;
}

export interface DevPlan {
  readonly instanceDir: string;
  readonly storefrontDir: string | null;
  readonly processes: readonly DevLayer[];
  /** What was left out and why, printed before anything starts. */
  readonly notes: readonly string[];
}

export interface DevOptions {
  /** The directory it was typed in; the instance is its root manifest. */
  readonly cwd: string;
  /**
   * Where the storefront is. `undefined` looks for the default sibling,
   * a string names one (relative to {@link cwd}), `false` starts none.
   */
  readonly storefront?: string | false | undefined;
}

function scriptsOf(manifestPath: string): Record<string, unknown> | null {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { scripts?: unknown };
    const scripts = manifest.scripts;
    return typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
}

/**
 * The layers this tree has, decided from its manifests and from nothing else.
 *
 * Validates completely before anything is started, in `runNewInstance`'s
 * discipline: a run that started the API and then refused over the storefront
 * would leave a process behind for a refusal.
 */
export function planDev(options: DevOptions): DevPlan {
  const instanceDir = resolve(options.cwd);
  const manifestPath = join(instanceDir, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new DevHostError(
      `there is no package.json in ${instanceDir}. \`endora dev\` is run from the root of an ` +
        'instance — the directory `endora install` or `endora new instance` wrote — as ' +
        '`pnpm run dev:all`.',
    );
  }
  const scripts = scriptsOf(manifestPath);
  if (scripts === null) {
    throw new DevHostError(`${manifestPath} could not be read as JSON.`);
  }
  if (typeof scripts['start'] !== 'string') {
    throw new DevInputError(
      `${manifestPath} declares no \`start\` script, so there is no API to start. An instance ` +
        "declares one; this is not an instance's root, or its manifest has lost the script.",
    );
  }

  const notes: string[] = [];
  const processes: DevLayer[] = [{ label: 'api', cwd: instanceDir, script: 'start' }];
  if (typeof scripts['preview:admin'] === 'string') {
    processes.push({ label: 'admin', cwd: instanceDir, script: 'preview:admin' });
  } else {
    notes.push(
      'no admin preview: this instance declares no `preview:admin`, because it was written ' +
        'without the admin member.',
    );
  }

  let storefrontDir: string | null = null;
  if (options.storefront !== false) {
    const named = typeof options.storefront === 'string';
    const candidate = named
      ? isAbsolute(options.storefront as string)
        ? (options.storefront as string)
        : resolve(instanceDir, options.storefront as string)
      : join(dirname(instanceDir), `${basename(instanceDir)}-storefront`);
    const storefrontManifest = join(candidate, 'package.json');
    if (!existsSync(storefrontManifest)) {
      if (named) {
        throw new DevInputError(
          `--storefront-dir ${candidate} holds no storefront (no package.json there). Name the ` +
            'directory `endora new storefront` wrote, or pass `--no-storefront`.',
        );
      }
      notes.push(
        `no storefront: none at ${candidate}, where \`endora install\` writes it by default. ` +
          'Pass `--storefront-dir <path>` if yours is elsewhere.',
      );
    } else {
      const storefrontScripts = scriptsOf(storefrontManifest);
      if (storefrontScripts === null || typeof storefrontScripts['dev'] !== 'string') {
        throw new DevInputError(
          `${storefrontManifest} declares no \`dev\` script, so there is no storefront to start ` +
            'from it. Pass `--no-storefront` to start the other layers alone.',
        );
      }
      storefrontDir = candidate;
      processes.push({ label: 'storefront', cwd: candidate, script: 'dev' });
    }
  }

  return { instanceDir, storefrontDir, processes, notes };
}

/** One process the supervisor runs, as a command line. */
export interface SupervisedProcess {
  readonly label: string;
  readonly cwd: string;
  readonly bin: string;
  readonly argv: readonly string[];
}

/**
 * How a package script is run from here.
 *
 * `pnpm run dev:all` sets `npm_execpath` to the package manager that is running
 * it, so the layers are started by the same one — which matters when the
 * operator reached pnpm through `corepack pnpm@…` and there is no `pnpm` on
 * `PATH` at all. Absent, `pnpm` is what an instance declares in its own
 * `packageManager`.
 */
export function commandFor(
  layer: DevLayer,
  env: NodeJS.ProcessEnv = process.env,
): SupervisedProcess {
  const execPath = env['npm_execpath'];
  if (execPath !== undefined && /pnpm/.test(basename(execPath)) && /\.[cm]?js$/.test(execPath)) {
    return {
      label: layer.label,
      cwd: layer.cwd,
      bin: process.execPath,
      argv: [execPath, 'run', layer.script],
    };
  }
  return { label: layer.label, cwd: layer.cwd, bin: 'pnpm', argv: ['run', layer.script] };
}

export interface SuperviseOptions {
  /** Where a line goes. The argv layer passes stdout. */
  readonly write: (line: string) => void;
  /** An interrupt: every layer is stopped and the run ends `0`. */
  readonly signal?: AbortSignal | undefined;
  /** How long a layer gets between the polite stop and the forced one. */
  readonly graceMs?: number | undefined;
}

/** `128 + n`, the shell's own convention for a process ended by a signal. */
function codeForSignal(signal: NodeJS.Signals): number {
  const number = (constants.signals as Record<string, number | undefined>)[signal];
  return number === undefined ? 1 : 128 + number;
}

/** Signal a layer and everything it started. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // Already gone, which is the state being asked for.
  }
}

/**
 * Run the layers until one ends or the operator interrupts, then stop them all.
 *
 * Resolves with the exit code the command reports: `0` for an interrupt (the
 * operator asked for the stop and got it), the ending layer's own code when it
 * failed, and `1` when a layer ended with `0` — a server that returned is not
 * running, and the other layers are no use without it.
 */
export function superviseDev(
  processes: readonly SupervisedProcess[],
  options: SuperviseOptions,
): Promise<number> {
  const graceMs = options.graceMs ?? 10_000;
  const { write } = options;
  return new Promise((resolveCode) => {
    const running = new Map<string, number>();
    const exits: Promise<void>[] = [];
    let stopping = false;
    let result: number | null = null;
    let forceTimer: NodeJS.Timeout | null = null;

    const finishWhenAllStopped = (): void => {
      void Promise.all(exits).then(() => {
        if (forceTimer !== null) clearTimeout(forceTimer);
        options.signal?.removeEventListener('abort', onAbort);
        resolveCode(result ?? 0);
      });
    };

    const stopAll = (): void => {
      if (stopping) return;
      stopping = true;
      const left = [...running.keys()];
      if (left.length > 0) write(`[endora dev] stopping ${left.join(', ')}`);
      for (const pid of running.values()) signalGroup(pid, 'SIGTERM');
      forceTimer = setTimeout(() => {
        for (const pid of running.values()) signalGroup(pid, 'SIGKILL');
      }, graceMs);
      forceTimer.unref();
      finishWhenAllStopped();
    };

    function onAbort(): void {
      if (result === null) result = 0;
      stopAll();
    }

    for (const entry of processes) {
      const child = spawn(entry.bin, [...entry.argv], {
        cwd: entry.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      const prefix = (chunk: string, carry: { rest: string }): void => {
        const text = carry.rest + chunk;
        const lines = text.split(/\r?\n/);
        carry.rest = lines.pop() ?? '';
        for (const line of lines) write(`[${entry.label}] ${line}`);
      };
      const out = { rest: '' };
      const err = { rest: '' };
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => prefix(chunk, out));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => prefix(chunk, err));
      if (child.pid !== undefined) running.set(entry.label, child.pid);

      exits.push(
        new Promise<void>((done) => {
          let settled = false;
          const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
            if (settled) return;
            settled = true;
            for (const carry of [out, err]) {
              if (carry.rest.length > 0) write(`[${entry.label}] ${carry.rest}`);
              carry.rest = '';
            }
            running.delete(entry.label);
            // Anything it left behind in its group goes with it.
            if (child.pid !== undefined) signalGroup(child.pid, 'SIGKILL');
            if (!stopping) {
              const described =
                signal !== null ? `was ended by ${signal}` : `exited with code ${String(code)}`;
              write(`[endora dev] ${entry.label} ${described}`);
              result = signal !== null ? codeForSignal(signal) : code === 0 ? 1 : (code ?? 1);
              stopAll();
            }
            done();
          };
          child.on('error', (error) => {
            write(`[endora dev] ${entry.label} could not be started: ${error.message}`);
            if (!stopping) {
              result = 127;
              stopAll();
            }
            settle(127, null);
          });
          child.on('close', settle);
        }),
      );
    }

    if (options.signal?.aborted === true) {
      onAbort();
    } else {
      options.signal?.addEventListener('abort', onAbort);
    }
  });
}

/**
 * The whole command: plan, print what starts and what does not, supervise.
 */
export async function runDev(
  options: DevOptions & {
    readonly write: (line: string) => void;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<number> {
  const plan = planDev(options);
  options.write(
    `endora dev — ${plan.processes.map((layer) => `${layer.label} (pnpm run ${layer.script})`).join(', ')}`,
  );
  for (const note of plan.notes) options.write(`  ${note}`);
  options.write('  Ctrl-C stops all of them; any one ending stops the rest.');
  return superviseDev(
    plan.processes.map((layer) => commandFor(layer)),
    { write: options.write, signal: options.signal },
  );
}
