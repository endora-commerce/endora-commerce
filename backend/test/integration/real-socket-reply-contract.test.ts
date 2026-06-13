import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Real-socket regression guard for the `ERR_HTTP_HEADERS_SENT` crash class.
 *
 * Every other backend route/contract test uses `app.inject()` (light-my-request),
 * which does NOT go through Node's real `node:_http_server`. A whole class of
 * crashes is therefore invisible under `inject`: an **async** handler that calls
 * `reply.send()` WITHOUT `return reply`, combined with the app's async `onSend`
 * hooks (the `x-request-id` stamp in `http/server.ts` + `@fastify/rate-limit`
 * headers), makes Fastify re-send the already-sent reply. The second send's
 * onSend chain reaches `writeHead` after the headers were flushed →
 * `ERR_HTTP_HEADERS_SENT` thrown as an **uncaught exception** → the process
 * crash-loops (the original prod symptom on `/api/v1/_health`).
 *
 * vitest's worker installs its own uncaughtException handling that swallows the
 * crash (just like inject hides it), so we observe it in a clean CHILD process:
 * the probe boots the real `buildServer` stack over a real socket and exits
 * non-zero only when the missing-`return` anti-pattern crashes it.
 *
 * Convention enforced project-wide: async handlers must
 * `return reply.status(...).send(...)` (or `return payload`).
 */

const probe = fileURLToPath(new URL('../helpers/reply-return-probe.ts', import.meta.url));

function runProbe(mode: 'buggy' | 'fixed'): { status: number | null; stderr: string } {
  const res = spawnSync('pnpm', ['exec', 'tsx', probe, mode], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: res.status, stderr: res.stderr ?? '' };
}

describe('real-socket reply contract (ERR_HTTP_HEADERS_SENT guard)', () => {
  it('async handler that RETURNS reply.send() serves cleanly over a real socket', () => {
    const { status } = runProbe('fixed');
    expect(status).toBe(0);
  });

  it('proves the trap: NOT returning reply.send() crashes the process over a real socket (inject hides it)', () => {
    const { status, stderr } = runProbe('buggy');
    expect(status).not.toBe(0);
    expect(stderr).toContain('ERR_HTTP_HEADERS_SENT');
  });
});
