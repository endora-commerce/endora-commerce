/**
 * What the request logger never writes out, as pino `redact` paths.
 *
 * One list for the two places a logger is configured — `buildServer` and
 * `createLogger` — because they carried the same literal twice, and a path
 * added to one and not the other is a secret in a log.
 *
 * A `*.name` path covers `name` on any object logged one level down, which is
 * the shape a handler produces when it logs a request body or a command
 * input: `log.info({ body })`. Every spelling a password travels under in an
 * API body is listed — `password` (sign-in, account creation, the admin
 * self-service change and the peer reset), `currentPassword` (both
 * change-password routes) and `newPassword` (the buyer-side change and the
 * reset confirmation) — beside the hash and the generic `secret`.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.secret',
];

export const LOG_REDACT_CENSOR = '[REDACTED]';
