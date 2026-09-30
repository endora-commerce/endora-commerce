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
 *
 * It takes the two values rather than an environment, so `composeApp` keeps
 * reading both as `process.env['NAME']` — the form `check:env-inputs` sees.
 */
export function newsletterTokenSecretFrom(
  newsletterTokenSecret: string | undefined,
  sessionCookieSecret: string | undefined,
): string {
  if (newsletterTokenSecret !== undefined && newsletterTokenSecret !== '') {
    return newsletterTokenSecret;
  }
  return sessionCookieSecret ?? '';
}
