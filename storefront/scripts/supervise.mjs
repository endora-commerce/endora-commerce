// The storefront image's command: run the Next.js server as a child, and end
// the container when that child stops answering (issue #152).
//
//   node storefront/scripts/supervise.mjs storefront/server.js
//
// ## Why a parent process
//
// Docker restarts a container whose main process has **exited**. It does
// nothing for one that is merely `unhealthy`, so a server whose process is
// alive but no longer answering — its event loop starved or blocked, or every
// request stuck — stays down until somebody notices. The server cannot be its
// own watchdog: a timer on the main thread never fires while the loop is
// starved, `process.exit()` from a worker thread ends only the worker, and when
// the server is PID 1 of its PID namespace the kernel drops a `SIGKILL` it
// sends to itself.
//
// This process has its own event loop, so the server's state cannot stop it,
// and it signals a **child** — which is never PID 1, so `SIGKILL` always lands.
// It asks the child over HTTP whether it still answers; after a run of
// consecutive unanswered probes it sends `SIGTERM`, then `SIGKILL`, and exits
// non-zero. `restart: unless-stopped` turns that exit into a fresh container.
//
// ## What counts as an answer
//
// **Any HTTP response, whatever its status.** This is a liveness probe, not a
// health check: a `503` because the backend is down, or a `500` from a
// defect, is the process alive and answering, and restarting it would not
// repair either. Only a refused connection, a reset or no response within the
// timeout counts as a failure. The default address, `/robots.txt`, is a route
// every storefront serves whose only backend read is bounded and cached
// (`lib/seo/crawler-policy.ts`), so a slow backend does not read as a hung
// storefront. The compose healthcheck keeps asking `/` for the health state.
//
// ## As PID 1
//
// With no init process this script is PID 1. It installs handlers for the
// signals it forwards, so `docker stop`'s `SIGTERM` is not ignored as an
// unhandled signal to PID 1 is. What PID 1 also owes the namespace is reaping
// orphaned grandchildren, which Node does not do — so the compose examples set
// `init: true`, which puts Docker's own init in front of this script; `docker
// run --init` is the same for a hand-run container. Without it nothing here
// breaks; an orphan the server leaves behind stays a zombie until the
// container ends.
//
// ## Configuration
//
// Every value has a default and every variable is optional. A value this
// script cannot read stops the container at start rather than being guessed
// at — documented in `docs/docs/deployment/storefront-supervisor.md`.
//
// No dependency: this file runs in the image's runtime stage, where only the
// standalone server's traced files exist.
import { spawn as spawnProcess } from 'node:child_process';
import { constants } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What every line this process writes starts with. */
const PREFIX = 'storefront-supervisor: ';

/** The exit code of a container the probe ended. Non-zero, so it is restarted. */
export const WATCHDOG_EXIT_CODE = 1;

/**
 * How long to wait, after `SIGKILL`, for the child's exit to be reported
 * before exiting regardless. A process stuck in uninterruptible sleep is not
 * reaped until it wakes; ending this process still ends the container, and the
 * kernel tears the rest of the namespace down.
 */
export const EXIT_AFTER_KILL_MS = 5_000;

/** The signals forwarded to the child. */
export const FORWARDED_SIGNALS = /** @type {const} */ (['SIGTERM', 'SIGINT', 'SIGHUP']);

export const SUPERVISOR_ENV = /** @type {const} */ ({
  probe: 'STOREFRONT_SUPERVISOR_PROBE',
  probeUrl: 'STOREFRONT_SUPERVISOR_PROBE_URL',
  interval: 'STOREFRONT_SUPERVISOR_INTERVAL_SECONDS',
  timeout: 'STOREFRONT_SUPERVISOR_TIMEOUT_SECONDS',
  failures: 'STOREFRONT_SUPERVISOR_FAILURES',
  startGrace: 'STOREFRONT_SUPERVISOR_START_GRACE_SECONDS',
  killGrace: 'STOREFRONT_SUPERVISOR_KILL_GRACE_SECONDS',
});

export const SUPERVISOR_DEFAULTS = /** @type {const} */ ({
  probePath: '/robots.txt',
  intervalSeconds: 10,
  timeoutSeconds: 5,
  failures: 3,
  startGraceSeconds: 30,
  killGraceSeconds: 5,
});

/** A configuration value that cannot be read. The message names the variable. */
export class SupervisorConfigError extends Error {
  /**
   * @param {string} name
   * @param {string} value
   * @param {string} expected
   */
  constructor(name, value, expected) {
    super(`${name}=${JSON.stringify(value)} is not ${expected}.`);
    this.name = 'SupervisorConfigError';
  }
}

/**
 * @typedef {object} SupervisorConfig
 * @property {boolean} probe
 * @property {string} probeUrl
 * @property {number} intervalMs
 * @property {number} timeoutMs
 * @property {number} failures
 * @property {number} startGraceMs
 * @property {number} killGraceMs
 */

const OFF = new Set(['off', 'false', '0', 'no']);
const ON = new Set(['on', 'true', '1', 'yes', '']);

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {number} fallback
 * @param {{ min: number, exclusive: boolean, integer?: boolean }} bound
 */
function number(env, name, fallback, bound) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  const inRange = bound.exclusive ? value > bound.min : value >= bound.min;
  if (!Number.isFinite(value) || !inRange || (bound.integer === true && !Number.isInteger(value))) {
    const kind = bound.integer === true ? 'a whole number' : 'a number';
    const relation = bound.exclusive ? 'greater than' : 'at least';
    throw new SupervisorConfigError(name, raw, `${kind} ${relation} ${String(bound.min)}`);
  }
  return value;
}

/**
 * The supervisor's configuration, read from the environment.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {SupervisorConfig}
 */
export function supervisorConfig(env) {
  const switchRaw = env[SUPERVISOR_ENV.probe];
  const switchWord = (switchRaw ?? '').trim().toLowerCase();
  if (!OFF.has(switchWord) && !ON.has(switchWord)) {
    throw new SupervisorConfigError(SUPERVISOR_ENV.probe, switchRaw ?? '', '`on` or `off`');
  }

  const port = number(env, 'PORT', 3000, { min: 0, exclusive: true, integer: true });
  const urlRaw = env[SUPERVISOR_ENV.probeUrl];
  let probeUrl = `http://127.0.0.1:${String(port)}${SUPERVISOR_DEFAULTS.probePath}`;
  if (urlRaw !== undefined && urlRaw.trim() !== '') {
    let parsed = null;
    try {
      parsed = new URL(urlRaw.trim());
    } catch {
      parsed = null;
    }
    if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      throw new SupervisorConfigError(SUPERVISOR_ENV.probeUrl, urlRaw, 'an absolute http(s) URL');
    }
    probeUrl = parsed.href;
  }

  const seconds = (name, fallback, exclusive) =>
    Math.round(number(env, name, fallback, { min: 0, exclusive }) * 1000);
  return {
    probe: !OFF.has(switchWord),
    probeUrl,
    intervalMs: seconds(SUPERVISOR_ENV.interval, SUPERVISOR_DEFAULTS.intervalSeconds, true),
    timeoutMs: seconds(SUPERVISOR_ENV.timeout, SUPERVISOR_DEFAULTS.timeoutSeconds, true),
    failures: number(env, SUPERVISOR_ENV.failures, SUPERVISOR_DEFAULTS.failures, {
      min: 0,
      exclusive: true,
      integer: true,
    }),
    startGraceMs: seconds(SUPERVISOR_ENV.startGrace, SUPERVISOR_DEFAULTS.startGraceSeconds, false),
    killGraceMs: seconds(SUPERVISOR_ENV.killGrace, SUPERVISOR_DEFAULTS.killGraceSeconds, false),
  };
}

/** @param {string} signal */
function signalExitCode(signal) {
  const number = /** @type {Record<string, number>} */ (constants.signals)[signal];
  return 128 + (number ?? 0);
}

/** @param {unknown} error */
function describe(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = /** @type {{ cause?: { code?: string, message?: string } }} */ (error).cause;
  const detail = cause?.code ?? cause?.message;
  return (detail ? `${error.message} (${detail})` : error.message).replace(/\s+/g, ' ');
}

/** @param {number} ms */
function secondsText(ms) {
  return `${String(ms / 1000)} s`;
}

/**
 * @typedef {object} ChildLike
 * @property {number | undefined} pid
 * @property {(signal: string) => boolean} kill
 * @property {(event: string, listener: (...args: any[]) => void) => unknown} on
 */

/**
 * @typedef {object} SuperviseInput
 * @property {SupervisorConfig} config
 * @property {string} command  the interpreter the child runs on
 * @property {readonly string[]} args  its arguments — the server's path first
 * @property {(command: string, args: readonly string[], options: { stdio: 'inherit' }) => ChildLike} spawn
 * @property {(url: string, init: { signal: AbortSignal, redirect: 'manual', cache: 'no-store' }) => Promise<{ status: number, body?: { cancel(): Promise<unknown> } | null }>} fetch
 * @property {{ setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (handle: any) => void, now: () => number }} timers
 * @property {(line: string) => void} log
 * @property {(code: number) => void} exit
 * @property {(signal: string, handler: () => void) => void} onSignal
 */

/**
 * Start the child and supervise it until it ends. Calls `exit` exactly once.
 *
 * @param {SuperviseInput} input
 */
export function supervise(input) {
  const { config, timers } = input;
  const log = (/** @type {string} */ message) => input.log(PREFIX + message.replace(/\s*\n\s*/g, ' '));

  const startedAt = timers.now();
  /** Set once the child has answered, or the start grace has run out. */
  let graceOver = config.startGraceMs === 0;
  let consecutive = 0;
  /** `null` while running; why the child is being stopped once it is. */
  let stopping = /** @type {null | 'watchdog' | 'signal'} */ (null);
  let finished = false;
  let probeTimer = /** @type {any} */ (null);
  let killTimer = /** @type {any} */ (null);
  let abandonTimer = /** @type {any} */ (null);

  function finish(/** @type {number} */ code, /** @type {string} */ why) {
    if (finished) return;
    finished = true;
    for (const handle of [probeTimer, killTimer, abandonTimer]) {
      if (handle !== null) timers.clearTimeout(handle);
    }
    log(`${why}; exiting with ${String(code)}`);
    input.exit(code);
  }

  const child = input.spawn(input.command, input.args, { stdio: 'inherit' });
  log(
    `started the server (pid ${String(child.pid ?? '?')}): ${[input.command, ...input.args].join(' ')}`,
  );

  child.on('error', (/** @type {unknown} */ error) => {
    finish(1, `the server could not be started or signalled: ${describe(error)}`);
  });

  child.on('exit', (/** @type {number | null} */ code, /** @type {string | null} */ signal) => {
    const how = signal !== null ? `was ended by ${signal}` : `exited with code ${String(code)}`;
    if (stopping === 'watchdog') {
      finish(WATCHDOG_EXIT_CODE, `the server ${how} after it stopped answering`);
      return;
    }
    const exitCode = signal !== null ? signalExitCode(signal) : (code ?? 1);
    finish(exitCode, `the server ${how}`);
  });

  function send(/** @type {string} */ signal) {
    try {
      child.kill(signal);
    } catch (error) {
      log(`could not send ${signal} to the server: ${describe(error)}`);
    }
  }

  /** `SIGTERM` (or the forwarded signal) is already sent; escalate if it is ignored. */
  function armKill() {
    if (killTimer !== null) return;
    killTimer = timers.setTimeout(() => {
      killTimer = null;
      if (finished) return;
      log(
        `the server is still running ${secondsText(config.killGraceMs)} after being asked to stop; sending SIGKILL`,
      );
      send('SIGKILL');
      abandonTimer = timers.setTimeout(() => {
        abandonTimer = null;
        finish(
          stopping === 'watchdog' ? WATCHDOG_EXIT_CODE : signalExitCode('SIGKILL'),
          `the server's exit was not reported ${secondsText(EXIT_AFTER_KILL_MS)} after SIGKILL`,
        );
      }, EXIT_AFTER_KILL_MS);
    }, config.killGraceMs);
  }

  for (const signal of FORWARDED_SIGNALS) {
    input.onSignal(signal, () => {
      if (finished) return;
      if (stopping === null) {
        stopping = 'signal';
        if (probeTimer !== null) timers.clearTimeout(probeTimer);
        probeTimer = null;
        log(`received ${signal}; forwarding it to the server and stopping the probe`);
      } else {
        log(`received ${signal} again; forwarding it to the server`);
      }
      send(signal);
      armKill();
    });
  }

  /** One probe; resolves to `null` for an answer, or the reason there was none. */
  async function probeOnce() {
    const controller = new globalThis.AbortController();
    let timeoutHandle = /** @type {any} */ (null);
    const timedOut = new Promise((resolveTimeout) => {
      timeoutHandle = timers.setTimeout(() => {
        controller.abort();
        resolveTimeout(`no answer within ${String(config.timeoutMs)} ms`);
      }, config.timeoutMs);
    });
    const answered = input
      .fetch(config.probeUrl, { signal: controller.signal, redirect: 'manual', cache: 'no-store' })
      .then(
        (response) => {
          // The status is the answer; the body is not needed, and an unread
          // one holds the connection.
          response.body?.cancel().catch(() => {});
          return null;
        },
        (error) => describe(error),
      );
    try {
      // The timer resolves before the abort it triggers can reject the fetch,
      // so a timed-out probe always reports the timeout.
      return await Promise.race([answered, timedOut]);
    } finally {
      timers.clearTimeout(timeoutHandle);
    }
  }

  function schedule() {
    if (finished || stopping !== null) return;
    probeTimer = timers.setTimeout(() => {
      probeTimer = null;
      void probeOnce().then(judge);
    }, config.intervalMs);
  }

  function judge(/** @type {string | null} */ failure) {
    if (finished || stopping !== null) return;
    if (failure === null) {
      if (!graceOver) {
        graceOver = true;
        log('the server answered its first probe; the start grace is over');
      } else if (consecutive > 0) {
        log(`the server answered again after ${String(consecutive)} failed probes`);
      }
      consecutive = 0;
      schedule();
      return;
    }
    if (!graceOver && timers.now() - startedAt < config.startGraceMs) {
      log(`probe failed inside the start grace, not counted: ${failure}`);
      schedule();
      return;
    }
    graceOver = true;
    consecutive += 1;
    log(`probe failed (${String(consecutive)}/${String(config.failures)}): ${failure}`);
    if (consecutive < config.failures) {
      schedule();
      return;
    }
    stopping = 'watchdog';
    log(
      `the server did not answer ${String(config.failures)} consecutive probes of ${config.probeUrl}; sending SIGTERM`,
    );
    send('SIGTERM');
    armKill();
  }

  if (config.probe) {
    log(
      `probing ${config.probeUrl} every ${secondsText(config.intervalMs)} (timeout ` +
        `${secondsText(config.timeoutMs)}, ${String(config.failures)} consecutive failures, start grace ` +
        `${secondsText(config.startGraceMs)}, kill grace ${secondsText(config.killGraceMs)})`,
    );
    schedule();
  } else {
    log(`the liveness probe is off (${SUPERVISOR_ENV.probe}); supervising signals and exit only`);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const write = (/** @type {string} */ line) => process.stderr.write(`${line}\n`);
  const args = process.argv.slice(2);
  /** @type {SupervisorConfig | null} */
  let config = null;
  try {
    if (args.length === 0) throw new Error('usage: node supervise.mjs <server.js> [args…]');
    config = supervisorConfig(process.env);
  } catch (error) {
    write(`${PREFIX}${error instanceof Error ? error.message : String(error)} Refusing to start.`);
    process.exit(1);
  }
  supervise({
    config,
    command: process.execPath,
    args,
    spawn: (command, childArgs, options) => spawnProcess(command, [...childArgs], options),
    fetch: (url, init) => globalThis.fetch(url, init),
    timers: {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle),
      now: () => Date.now(),
    },
    log: write,
    exit: (code) => process.exit(code),
    onSignal: (signal, handler) => process.on(signal, handler),
  });
}
