/**
 * Child-process probe for the `ERR_HTTP_HEADERS_SENT` double-send class.
 *
 * Boots the REAL production middleware stack (`buildServer`) over a REAL socket
 * and hits a probe route once. Run with one argument:
 *
 *   tsx reply-return-probe.ts buggy   → async handler calls reply.send() WITHOUT
 *                                        `return reply`; the async onSend hooks
 *                                        open a window in which Fastify sends the
 *                                        reply a second time, and the second
 *                                        `writeHead` throws ERR_HTTP_HEADERS_SENT.
 *   tsx reply-return-probe.ts fixed   → handler returns the reply; one send.
 *
 * Whether that throw kills the process depends on Fastify: up to 5.10 it
 * escaped as an uncaught exception (exit non-zero — the original prod crash
 * loop); from 5.11.0 the onSend hook runner catches it and routes it to the
 * error handler, which logs it. The probe reports both halves so the driving
 * test can tell them apart: the exit code says whether the process survived,
 * the logger output (stdout) says whether a double-send happened, and the
 * `REPLY_PROBE_RESULT` line says what the client actually received.
 *
 * Driven by real-socket-reply-contract.test.ts, which runs it as a separate
 * process because a crash is only observable as that process's exit code.
 */
import type { FastifyInstance } from 'fastify';
import { buildServer } from '@endora-commerce/platform/composition';

const mode = process.argv[2];

const app = await buildServer({
  sessionCookieSecret: 'test-secret-do-not-use-in-production',
  openApi: { title: 'reply-return-probe', version: 'test', serverUrl: 'http://localhost' },
  // Rate limit ON (default) — its async onSend hook, like the x-request-id hook
  // in http/server.ts, is part of what opens the double-send window in prod.
  modules: [
    (a: FastifyInstance): void => {
      // One explicit awaiting onSend hook so the window is deterministically
      // open and the crash is reproducible regardless of host scheduling.
      a.addHook('onSend', async (_req, _reply, payload) => {
        await new Promise((r) => setTimeout(r, 5));
        return payload;
      });
      a.get('/api/v1/_probe', async (_req, reply) => {
        // A JSON body (like the real /api/v1/_health) keeps the send chain open
        // long enough for the double-send to surface.
        const body = { status: 'ok' };
        if (mode === 'buggy') {
          reply.status(200).send(body);
        } else {
          return reply.status(200).send(body);
        }
      });
    },
  ],
});

await app.listen({ port: 0, host: '127.0.0.1' });
const { port } = app.server.address() as { port: number };
const res = await fetch(`http://127.0.0.1:${port}/api/v1/_probe`);
const receivedBody = await res.text();
process.stdout.write(`\nREPLY_PROBE_RESULT ${JSON.stringify({ status: res.status, body: receivedBody })}\n`);
// Give the post-response tick time to throw (buggy) before we exit cleanly.
await new Promise((r) => setTimeout(r, 250));
await app.close();
process.exit(0);
