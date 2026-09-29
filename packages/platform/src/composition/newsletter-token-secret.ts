/**
 * The key newsletter confirmation and unsubscribe links are signed with.
 *
 * `NEWSLETTER_TOKEN_SECRET`, and absent that the session key — the platform
 * declaration's own sentence (`../env/index.ts`).
 *
 * **An empty value is absent**, the rule `resolveSessionCookieSecret` states for
 * the session key. Compose's `${NEWSLETTER_TOKEN_SECRET}` hands the process an
 * empty string for an `.env` that leaves the line blank, and the inline chain
 * this replaced used `??`, which keeps `''`: the newsletter token helper refuses
 * an empty key, so the backend exited 1 inside `buildServer` on exactly the
 * configuration every example described as "leave it empty and the session key
 * is used". The answer is `''` only when neither has a value; no key is invented.
 */
export function newsletterTokenSecretFrom(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const own = env['NEWSLETTER_TOKEN_SECRET'];
  if (own !== undefined && own !== '') return own;
  return env['SESSION_COOKIE_SECRET'] ?? '';
}
