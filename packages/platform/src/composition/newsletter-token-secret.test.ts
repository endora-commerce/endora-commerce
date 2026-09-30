import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { newsletterTokenSecretFrom } from './newsletter-token-secret.js';

/**
 * The key newsletter links are signed with — `NEWSLETTER_TOKEN_SECRET`, and the
 * session key when it has none (the platform declaration's own sentence).
 *
 * **Empty is absent.** Compose's `${NEWSLETTER_TOKEN_SECRET}` hands the process
 * an empty string for an `.env` that leaves the line blank, and the chain was
 * written with `??`, which keeps `''`. The newsletter token helper refuses an
 * empty key, so the backend exited 1 inside `buildServer` on exactly the
 * configuration every example described as "leave it empty and the session key
 * is used". `resolveSessionCookieSecret` in the backend states the same rule for
 * the session key.
 *
 * The second half holds `composeApp` to this function, so the registration
 * cannot drift back to an inline chain.
 */
describe('newsletterTokenSecret', () => {
  it('uses NEWSLETTER_TOKEN_SECRET when it has a value', () => {
    expect(newsletterTokenSecretFrom('n', 's')).toBe('n');
  });

  it('falls back to SESSION_COOKIE_SECRET when NEWSLETTER_TOKEN_SECRET is unset', () => {
    expect(newsletterTokenSecretFrom(undefined, 's')).toBe('s');
  });

  it('falls back to SESSION_COOKIE_SECRET when NEWSLETTER_TOKEN_SECRET is empty', () => {
    expect(newsletterTokenSecretFrom('', 's')).toBe('s');
  });

  it('answers empty only when neither has a value, inventing no key', () => {
    expect(newsletterTokenSecretFrom('', '')).toBe('');
    expect(newsletterTokenSecretFrom(undefined, undefined)).toBe('');
  });

  it('is what composeApp registers, reading both as process.env[NAME]', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./compose-app.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toMatch(
      /newsletterTokenSecret: newsletterTokenSecretFrom\(\s*process\.env\['NEWSLETTER_TOKEN_SECRET'\],\s*process\.env\['SESSION_COOKIE_SECRET'\],\s*\)/,
    );
  });
});
