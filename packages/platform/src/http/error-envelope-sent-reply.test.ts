import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorEnvelope } from './error-envelope.js';

/**
 * An error that arrives **after the reply went out** is logged, and nothing is
 * sent on top of it.
 *
 * ## The measurement this file was written from
 *
 * An async handler that calls `reply.send()` without `return reply` makes
 * Fastify send the reply a second time; over a real socket the second send's
 * onSend chain reaches `writeHead` after the headers were flushed and Node
 * throws `ERR_HTTP_HEADERS_SENT`. From Fastify 5.11 the hook runner hands that
 * error to the error handler (the server survives — see
 * `backend/test/contract/real-socket-reply-contract.test.ts`), and the handler
 * then answered it the way it answers any unknown error: `reply.status(500)
 * .send(envelope)`. On a reply that has already ended that send is refused, and
 * Fastify logs `FST_ERR_REP_ALREADY_SENT` — a second warning about a response
 * nobody can receive, written by the code meant to explain the first one.
 *
 * ## The rule
 *
 * The original error is the one worth reading, so it is logged once, at
 * `error`, and the handler sends nothing. The double-send stays visible —
 * that log line is how the missing `return` is found.
 *
 * Over a real socket, deliberately: `inject()` does not run Node's
 * `ServerResponse.writeHead` the way a socket does, and this class is the one
 * it is known to hide.
 */

interface CapturedLine {
  readonly level: number;
  readonly msg?: string;
  readonly err?: { readonly code?: string; readonly message?: string };
}

let opened: FastifyInstance | undefined;

afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

async function serveDoubleSend(): Promise<{
  lines: CapturedLine[];
  received: { status: number; body: string };
}> {
  const lines: CapturedLine[] = [];
  const app: FastifyInstance = Fastify({
    logger: {
      level: 'trace',
      stream: {
        write(chunk: string) {
          lines.push(JSON.parse(chunk) as CapturedLine);
        },
      },
    },
  });
  opened = app;
  registerErrorEnvelope(app);
  // An awaiting onSend hook holds the first send open long enough for the
  // handler's resolution to start a second one — the shape `x-request-id` and
  // `@fastify/rate-limit` give the production stack.
  app.addHook('onSend', async (_request, _reply, payload) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return payload;
  });
  app.get('/double-send', async (_request, reply) => {
    // The defect under test: no `return`.
    void reply.status(200).send({ status: 'ok' });
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/double-send`);
  const received = { status: response.status, body: await response.text() };
  // The second send settles after the client has its response.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { lines, received };
}

describe('the error envelope on a reply that was already sent', () => {
  it('logs the original error once and sends nothing on top of it', async () => {
    const { lines, received } = await serveDoubleSend();

    // The client got the first, intact reply.
    expect(received).toEqual({ status: 200, body: JSON.stringify({ status: 'ok' }) });

    const headersSent = lines.filter((line) => line.err?.code === 'ERR_HTTP_HEADERS_SENT');
    expect(
      headersSent.filter((line) => line.level >= 50),
      'the double-send must stay visible: it is how the missing `return` is found',
    ).toHaveLength(1);

    expect(
      lines.filter((line) => line.err?.code === 'FST_ERR_REP_ALREADY_SENT'),
      'the error handler sent a 500 on a reply that had already ended',
    ).toEqual([]);
  });
});
