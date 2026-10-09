// `request.unsignCookie` and `reply.setCookie` are `@fastify/cookie`'s
// augmentation; the type-only import loads it and emits nothing.
import type {} from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ADMIN_KNOWN_DEVICE_COOKIE_NAME,
  ADMIN_KNOWN_DEVICE_MAX_AGE_SECONDS,
} from '@endora-commerce/contracts';

/**
 * The known-device cookie of the administrator authentication throttle: read
 * it verified, set it signed.
 *
 * The signature is the server's cookie secret, the one `@fastify/cookie` was
 * registered with, so nobody who has not completed a sign-in can write a value
 * this file will return. What the value means, and when it stops being
 * honoured, is `admin_users`' throttle's to say.
 *
 * `admin_users` and `mfa` each carry this file: both issue an administrator
 * session, and a module may not import another module's sources.
 */

/** The cookie's value when its signature verifies; otherwise nothing. */
export function readKnownDevice(request: FastifyRequest): string | undefined {
  const raw = (request as { cookies?: Record<string, string | undefined> }).cookies?.[
    ADMIN_KNOWN_DEVICE_COOKIE_NAME
  ];
  if (!raw) return undefined;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : undefined;
}

/**
 * Remember this device after a completed sign-in. `value` is what
 * `AdminAuthenticationThrottlePort.issueKnownDevice` answered; `null` sets
 * nothing.
 */
export function rememberKnownDevice(reply: FastifyReply, value: string | null): void {
  if (value === null) return;
  reply.setCookie(ADMIN_KNOWN_DEVICE_COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: ADMIN_KNOWN_DEVICE_MAX_AGE_SECONDS,
    signed: true,
  });
}
