import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Real-socket regression guard for the `ERR_HTTP_HEADERS_SENT` double-send class.
 *
 * Every other backend route/contract test runs `app.inject()` inside a vitest
 * worker, which is not how production runs, and an exit code is the one thing
 * such a test cannot observe. The class pinned here: an **async** handler that
 * calls `reply.send()` WITHOUT `return reply`, combined with the app's async
 * `onSend` hooks (the `x-request-id` stamp in `http/server.ts` +
 * `@fastify/rate-limit` headers), makes Fastify send the already-sent reply a
 * second time. The second send's onSend chain reaches `writeHead` after the
 * headers were flushed and Node throws `ERR_HTTP_HEADERS_SENT`.
 *
 * What that throw does has changed, and this file pins both halves:
 *
 * - **The trap is still there.** The missing `return` still double-sends over a
 *   real socket. The convention stays binding:
 *   async handlers must `return reply.status(...).send(...)` (or `return payload`).
 * - **The process survives it.** Up to Fastify 5.10 the throw escaped the onSend
 *   hook runner as an uncaught exception and the process crash-looped (the
 *   original prod symptom on `/api/v1/_health`). Fastify 5.11.0 wrapped the
 *   runner's promise continuation in a try/catch that hands the error to the
 *   error handler; the stack moved from 5.8.5 to 5.12.5 in 6a83bde33, and the
 *   assertion this file used to make — "the buggy probe exits non-zero" — went
 *   red there, because the crash it proved had stopped happening. A Fastify
 *   version, or a hook of ours, that lets the throw escape again would put every
 *   handler missing its `return` back into a crash loop, so the survival is
 *   asserted rather than assumed.
 *
 * Whether a process survives is observed in a clean CHILD process:
 * `reply-return-probe.ts` boots the real `buildServer` stack over a real socket,
 * prints the logger output, and reports what the client received.
 */

const probe = fileURLToPath(new URL('../helpers/reply-return-probe.ts', import.meta.url));

interface ProbeRun {
  status: number | null;
  /** stdout + stderr: the logger writes to stdout, an uncaught crash to stderr. */
  output: string;
  /** What the client received, or `undefined` if the probe died before reporting. */
  received: { status: number; body: string } | undefined;
}

function runProbe(mode: 'buggy' | 'fixed'): ProbeRun {
  const res = spawnSync('pnpm', ['exec', 'tsx', probe, mode], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  });
  const stdout = res.stdout ?? '';
  const line = stdout.split('\n').find((l) => l.startsWith('REPLY_PROBE_RESULT '));
  return {
    status: res.status,
    output: `${stdout}\n${res.stderr ?? ''}`,
    received: line === undefined ? undefined : JSON.parse(line.slice('REPLY_PROBE_RESULT '.length)),
  };
}

const servedBody = JSON.stringify({ status: 'ok' });

describe('real-socket reply contract (ERR_HTTP_HEADERS_SENT guard)', () => {
  it('async handler that RETURNS reply.send() sends exactly once over a real socket', () => {
    const run = runProbe('fixed');
    expect(run.status, run.output).toBe(0);
    expect(run.received).toEqual({ status: 200, body: servedBody });
    expect(run.output).not.toContain('ERR_HTTP_HEADERS_SENT');
    expect(run.output).not.toContain('FST_ERR_REP_ALREADY_SENT');
  });

  it('proves the trap: NOT returning reply.send() double-sends over a real socket', () => {
    const run = runProbe('buggy');
    // The second send reached `writeHead` after the headers were flushed.
    expect(run.output).toContain('ERR_HTTP_HEADERS_SENT');
    // ...and the stack contained it: the process did not crash and the client
    // got the first, intact reply. A non-zero exit here means the throw escaped
    // as an uncaught exception again — the production crash loop.
    expect(run.status, run.output).toBe(0);
    expect(run.received).toEqual({ status: 200, body: servedBody });
  });
});
