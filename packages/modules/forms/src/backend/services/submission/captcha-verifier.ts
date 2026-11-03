import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { isCaptchaConfigured } from '../form-warnings.js';
import { readCaptchaSettings } from '../forms-environment.js';
import { formCaptchaFailed, formCaptchaUnavailable } from '../forms-errors.js';

/**
 * The server-side CAPTCHA check of a submission (`specs/170-forms-module/` research R-14, FR-042,
 * research R-12 step 6).
 *
 * One `POST` with Node's global `fetch` to the configured provider's `siteverify`, form-encoded
 * `secret`, `response` and `remoteip` — both providers take the same three fields. No SDK (A-5,
 * Principle IV). The settings are read through `settingsReadPort` **per call**, so a key an operator
 * changes is the next submission's.
 *
 * - not configured (provider `none`, an unknown provider, or a key missing) → `not_configured`: the
 *   form is served and taken unprotected, and the builder warns (US6-4);
 * - a missing token, or the provider's `success` other than `true` → `400 FORM_CAPTCHA_FAILED`;
 * - a timeout (5 s), a network error, a non-2xx or a body that is not JSON → `503
 *   FORM_CAPTCHA_UNAVAILABLE` with `Retry-After` — **fail closed**: a submission is never taken
 *   because the check could not run.
 *
 * The secret goes into the request body to the provider and nowhere else: not into an error, its
 * details or a log line — nothing here logs at all.
 */

export const CAPTCHA_VERIFY_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
} as const;

export type CaptchaProvider = keyof typeof CAPTCHA_VERIFY_URLS;

/** How long the provider is given to answer (research R-14). */
export const CAPTCHA_TIMEOUT_MS = 5000;

export interface CaptchaVerifierDeps {
  readonly settings: Pick<SettingsReadPort, 'getMany'>;
  /** A shorter wait, for tests. */
  readonly timeoutMs?: number;
}

/** What a check found when it did not refuse. */
export type CaptchaCheck = 'verified' | 'not_configured';

function isProvider(value: string): value is CaptchaProvider {
  return Object.hasOwn(CAPTCHA_VERIFY_URLS, value);
}

export class CaptchaVerifier {
  constructor(private readonly deps: CaptchaVerifierDeps) {}

  async verify(input: { readonly token: string | undefined; readonly remoteIp: string | undefined }): Promise<CaptchaCheck> {
    const settings = await readCaptchaSettings(this.deps.settings);
    if (!isCaptchaConfigured(settings) || !isProvider(settings.provider)) return 'not_configured';

    const token = input.token?.trim() ?? '';
    if (token === '') throw formCaptchaFailed();

    const body = new URLSearchParams({ secret: settings.secretKey.trim(), response: token });
    if (input.remoteIp) body.set('remoteip', input.remoteIp);

    let answer: unknown;
    try {
      const response = await fetch(CAPTCHA_VERIFY_URLS[settings.provider], {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? CAPTCHA_TIMEOUT_MS),
      });
      if (!response.ok) throw formCaptchaUnavailable();
      answer = await response.json();
    } catch {
      // Whatever went wrong — the network, the clock, the provider's answer — the check did not run.
      throw formCaptchaUnavailable();
    }
    if (typeof answer !== 'object' || answer === null || (answer as { success?: unknown }).success !== true) {
      throw formCaptchaFailed();
    }
    return 'verified';
  }
}
