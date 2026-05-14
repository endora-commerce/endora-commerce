#!/usr/bin/env node
/**
 * Dev orchestrator — runs backend, storefront, and admin in parallel
 * and propagates Ctrl+C cleanly to every descendant.
 *
 * Why a custom script: `pnpm --parallel run dev` does not always
 * forward SIGINT to its grandchildren on Linux/macOS. The chain
 * pnpm → pnpm-per-package → tsx/next/vite → node leaves stray
 * watchers + Next servers when the operator hits Ctrl+C, so the
 * next `pnpm dev` collides on EADDRINUSE.
 *
 * This wrapper:
 *   - spawns each per-package `pnpm run dev` in its own *process group*
 *     (`detached: true` + `setsid` semantics on Linux);
 *   - relays SIGINT / SIGTERM to the whole process group of every
 *     child so tsx/next/vite's grandchildren die together;
 *   - waits up to GRACE_MS for graceful shutdown, then escalates to
 *     SIGKILL on any survivors.
 *
 * Run:  pnpm dev
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GRACE_MS = 5000;

/**
 * Minimal `.env` reader so each child sees its own PORT (and any other
 * vars) BEFORE the watcher binary starts. Required because Next.js reads
 * `process.env.PORT` to bind the dev server *before* it loads `.env*` —
 * so a `PORT=…` line in `storefront/.env` is otherwise ignored. Backend
 * (tsx --env-file-if-exists) and admin (vite loadEnv) already self-load,
 * but pre-injecting is harmless there and keeps every service uniform.
 */
function loadDotenv(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const raw of readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.replace(/^\s*export\s+/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Each service runs the dev binary directly (not via `pnpm run dev`)
 * so there's no wrapper layer between us and the watcher process. This
 * matters because pnpm's per-package wrapper exits early on SIGINT
 * while leaving its grandchildren (vite, next, tsx watch) reparented
 * to init — the wrapper's process group is empty by the time we'd
 * escalate to SIGKILL. By running the watcher binary directly under
 * `detached: true`, the watcher itself becomes the process-group
 * leader, and `process.kill(-pid, signal)` reaches it cleanly.
 */
const services = [
  {
    name: 'backend',
    color: '\x1b[36m',
    cwd: resolve(REPO_ROOT, 'backend'),
    cmd: resolve(REPO_ROOT, 'backend/node_modules/.bin/tsx'),
    args: ['watch', '--env-file-if-exists=.env', 'src/index.ts'],
  },
  {
    name: 'storefront',
    color: '\x1b[35m',
    cwd: resolve(REPO_ROOT, 'storefront'),
    cmd: resolve(REPO_ROOT, 'storefront/node_modules/.bin/next'),
    args: ['dev'],
  },
  {
    name: 'admin',
    color: '\x1b[33m',
    cwd: resolve(REPO_ROOT, 'admin'),
    cmd: resolve(REPO_ROOT, 'admin/node_modules/.bin/vite'),
    args: [],
  },
];
const RESET = '\x1b[0m';

function spawnService(svc) {
  const childEnv = { ...process.env, ...loadDotenv(join(svc.cwd, '.env')) };
  const child = spawn(
    svc.cmd,
    svc.args,
    {
      cwd: svc.cwd,
      detached: true,            // service binary becomes its own group leader
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    },
  );

  const prefix = `${svc.color}[${svc.name}]${RESET} `;
  const linePrefix = (line) => (line.length === 0 ? '' : prefix + line + '\n');

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      process.stdout.write(linePrefix(stdoutBuf.slice(0, nl)));
      stdoutBuf = stdoutBuf.slice(nl + 1);
    }
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    let nl;
    while ((nl = stderrBuf.indexOf('\n')) !== -1) {
      process.stderr.write(linePrefix(stderrBuf.slice(0, nl)));
      stderrBuf = stderrBuf.slice(nl + 1);
    }
  });

  child.on('exit', (code, signal) => {
    if (stdoutBuf) process.stdout.write(linePrefix(stdoutBuf));
    if (stderrBuf) process.stderr.write(linePrefix(stderrBuf));
    process.stdout.write(
      `${prefix}exited (${signal ? `signal ${signal}` : `code ${code}`})\n`,
    );
  });

  return child;
}

const children = services.map(spawnService);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`\n[dev] ${signal} received — stopping every service…\n`);

  for (const child of children) {
    if (child.pid) {
      try {
        // Negative pid signals the whole process group (Linux/macOS).
        process.kill(-child.pid, signal);
      } catch {
        // Group may already be gone — ignore.
      }
    }
  }

  setTimeout(() => {
    // Always escalate to SIGKILL on the group, even if the leader has
    // already exited cleanly: lingering grandchildren that reparented to
    // init still belong to the original PGID and a final SIGKILL flushes
    // them. On already-empty groups the call is a no-op (ESRCH).
    for (const child of children) {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }
    process.exit(0);
  }, GRACE_MS).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// If every child has already exited (e.g., they all crashed at startup),
// surface that and exit so the developer is not left staring at an
// empty terminal.
let exitedCount = 0;
for (const child of children) {
  child.on('exit', () => {
    exitedCount += 1;
    if (exitedCount === children.length && !shuttingDown) {
      process.stdout.write('[dev] every service exited — bye\n');
      process.exit(1);
    }
  });
}
