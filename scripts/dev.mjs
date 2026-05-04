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

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const GRACE_MS = 5000;

const services = [
  { name: 'backend',    color: '\x1b[36m', filter: 'backend' },
  { name: 'storefront', color: '\x1b[35m', filter: 'storefront' },
  { name: 'admin',      color: '\x1b[33m', filter: 'admin' },
];
const RESET = '\x1b[0m';

function spawnService(svc) {
  const child = spawn(
    'pnpm',
    ['--filter', svc.filter, 'run', 'dev'],
    {
      cwd: REPO_ROOT,
      detached: true,            // create a new process group → kill -PID kills the tree
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
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
    if (child.pid && !child.killed) {
      try {
        // Negative pid signals the whole process group (Linux/macOS).
        process.kill(-child.pid, signal);
      } catch {
        // Group may already be gone — ignore.
      }
    }
  }

  setTimeout(() => {
    let stragglers = 0;
    for (const child of children) {
      if (child.exitCode === null && !child.killed && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          stragglers += 1;
        } catch {
          /* gone */
        }
      }
    }
    if (stragglers > 0) {
      process.stdout.write(`[dev] ${stragglers} service(s) did not exit in ${GRACE_MS}ms — SIGKILL sent\n`);
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
