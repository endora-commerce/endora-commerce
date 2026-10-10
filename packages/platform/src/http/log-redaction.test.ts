/**
 * A password never reaches a log line, under any of the names it travels by.
 *
 * `currentPassword` and `newPassword` were missing from the redaction list
 * while `password` was on it, so a handler that logged a change-password body
 * would have written the administrator's current password in clear.
 *
 * The server builds its own logger and offers no stream to read it back from,
 * so the request below goes through a Fastify instance configured with the
 * same list, on the same route, and its output is read from memory.
 */
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from './log-redaction.js';

const CURRENT = 'the-current-pass-123!';
const NEXT = 'a-new-strong-pass-456!';

function memoryStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done): void {
      chunks.push(chunk.toString('utf8'));
      done();
    },
  });
  return { stream, text: () => chunks.join('') };
}

describe('log redaction', () => {
  it.each(['password', 'currentPassword', 'newPassword', 'passwordHash', 'secret'])(
    'censors `%s` on a logged object',
    (field) => {
      const { stream, text } = memoryStream();
      const logger = pino(
        { redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR } },
        stream,
      );
      logger.info({ body: { [field]: CURRENT, firstName: 'Ada' } }, 'request body');
      expect(text()).not.toContain(CURRENT);
      expect(text()).toContain(LOG_REDACT_CENSOR);
      expect(text()).toContain('Ada');
    },
  );

  it('keeps both secrets of a self-service password change out of the request log', async () => {
    const { stream, text } = memoryStream();
    const app = Fastify({
      logger: {
        level: 'info',
        redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR },
        stream,
      },
    });
    app.patch('/api/v1/admin/me', async (request) => {
      // The worst case a handler can produce: the whole body in a log line.
      request.log.info({ body: request.body }, 'self-service edit');
      return { data: {} };
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me',
      payload: { firstName: 'Ada', password: NEXT, currentPassword: CURRENT },
    });
    await app.close();
    expect(res.statusCode).toBe(200);

    const logged = text();
    // The request and response lines were written, and the handler's own line.
    expect(logged).toContain('/api/v1/admin/me');
    expect(logged).toContain('self-service edit');
    expect(logged).not.toContain(CURRENT);
    expect(logged).not.toContain(NEXT);
  });
});
