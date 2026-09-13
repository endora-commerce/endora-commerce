import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError, registerErrorEnvelope } from './error-envelope.js';

/**
 * A **server fault** is logged whether or not it arrived as an `HttpError`.
 *
 * ## The measurement this file was written from
 *
 * On 2026-09-13 a scaffolded instance answered `500 INTERNAL` to every
 * `/api/v1/*` request and wrote **nothing** about any of them. The cause was a
 * missing boot step (`compose-app.ts`, the default-channel reconciliation), but
 * the *silence* was this file's subject and it is the reason the defect stood
 * unattributed: `NoSystemDefaultChannel` extends `HttpError`, the handler's
 * `HttpError` branch returns before the `request.log.error` at the bottom, and
 * the envelope's `requestId` is the only trace the operator gets.
 *
 * Diagnosing it required patching a `console.error` into an installed package
 * inside `node_modules`. That is the cost of the gap, and it is paid by whoever
 * meets the next 5xx `HttpError` — of which the platform ships several
 * (`NoSystemDefaultChannel`, and every `HttpError(500, INTERNAL, …)` a module
 * throws for a composition it cannot make sense of).
 *
 * ## The rule, and where the line is drawn
 *
 * **The status code decides, not the class.** A 4xx is the client's fault and
 * says so in its own envelope — logging it would turn a scan for a typo'd SKU
 * into log volume, which is why the handler never did. A 5xx is the platform's
 * fault by definition, and an operator cannot act on a fault they cannot read.
 *
 * `warn` rather than `error` was considered and refused: a deployment filtering
 * at `error` is exactly the deployment that would then still be blind to this.
 */

interface CapturedLine {
  readonly level: number;
  readonly msg?: string;
  readonly err?: { readonly type?: string; readonly message?: string };
  readonly statusCode?: number;
  readonly code?: string;
}

/**
 * An app whose log lines are collectable.
 *
 * The stream is pino's own NDJSON, parsed rather than matched as text: the
 * assertions below are about the `err` serialisation and the status code, and a
 * substring match over a rendered line would pass on a message that happens to
 * contain the word.
 */
function buildProbe(): {
  app: ReturnType<typeof Fastify>;
  lines: CapturedLine[];
} {
  const lines: CapturedLine[] = [];
  const app = Fastify({
    logger: {
      level: 'error',
      stream: {
        write(chunk: string) {
          lines.push(JSON.parse(chunk) as CapturedLine);
        },
      },
    },
  });
  registerErrorEnvelope(app);
  app.get('/server-fault', async () => {
    throw new HttpError(500, ERROR_CODES.INTERNAL, 'the composition did not establish X');
  });
  app.get('/unavailable', async () => {
    throw new HttpError(503, ERROR_CODES.MODULE_DISABLED, 'the module is switched off');
  });
  app.get('/client-fault', async () => {
    throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
  });
  app.get('/bare', async () => {
    throw new Error('nobody wrapped this');
  });
  return { app, lines };
}

describe('the error envelope logs a server fault, however it was thrown', () => {
  it('logs a 500 HttpError, which is the one that answered nothing for months', async () => {
    const { app, lines } = buildProbe();
    const response = await app.inject({ method: 'GET', url: '/server-fault' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: ERROR_CODES.INTERNAL } });

    const logged = lines.filter((line) => line.level >= 50);
    expect(
      logged,
      'a 500 answered with no log line is a fault an operator can only find with a debugger',
    ).toHaveLength(1);
    expect(logged[0]?.err?.message).toBe('the composition did not establish X');
  });

  it('logs a 503 too — the boundary is 5xx, not the INTERNAL code', async () => {
    const { app, lines } = buildProbe();
    const response = await app.inject({ method: 'GET', url: '/unavailable' });

    expect(response.statusCode).toBe(503);
    expect(lines.filter((line) => line.level >= 50)).toHaveLength(1);
  });

  it('stays silent on a 4xx, which is the client saying something wrong', async () => {
    const { app, lines } = buildProbe();
    const response = await app.inject({ method: 'GET', url: '/client-fault' });

    expect(response.statusCode).toBe(404);
    expect(
      lines.filter((line) => line.level >= 50),
      'a 404 in the error log turns a mistyped URL into an incident',
    ).toHaveLength(0);
  });

  it('still logs an unwrapped throw exactly once, and does not double it', async () => {
    const { app, lines } = buildProbe();
    const response = await app.inject({ method: 'GET', url: '/bare' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: ERROR_CODES.INTERNAL } });
    expect(lines.filter((line) => line.level >= 50)).toHaveLength(1);
  });
});
