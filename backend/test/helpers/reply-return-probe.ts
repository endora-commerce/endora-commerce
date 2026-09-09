/**
 * Child-process probe for the `ERR_HTTP_HEADERS_SENT` crash class.
 *
 * Boots the REAL production middleware stack (`buildServer`) over a REAL socket
 * and hits a probe route once. Run with one argument:
 *
 *   tsx reply-return-probe.ts buggy   → async handler calls reply.send() WITHOUT
 *                                        `return reply`; the async onSend hooks
 *                                        trigger a double-send → ERR_HTTP_HEADERS_SENT
 *                                        thrown as an uncaught exception → the
 *                                        process exits non-zero.
 *   tsx reply-return-probe.ts fixed   → handler returns the reply; clean exit 0.
 *
 * Driven by real-socket-reply-contract.test.ts. We need a clean child process
 * because vitest's worker installs its own uncaughtException handling, which
 * swallows the crash — exactly the way `app.inject()` hides it from the suite.
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
await res.text();
// Give the post-response tick time to throw (buggy) before we exit cleanly.
await new Promise((r) => setTimeout(r, 250));
await app.close();
process.exit(0);
