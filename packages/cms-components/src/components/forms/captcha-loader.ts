/**
 * The CAPTCHA widget of a `forms.Form` block (`specs/170-forms-module/` contracts/blocks-and-storefront.md
 * §5, research R-14, FR-042): which script a provider needs, the container its widget renders into
 * and the field its token is posted in.
 *
 * The script is requested **only** by a block whose public read carries `captcha` — a form that
 * requires CAPTCHA while a provider is configured — and only in an effect, so the server HTML of no
 * page names a third-party script, and a page without such a form never loads one. It is requested
 * **once per page**, however many CAPTCHA forms it holds: a second block finds the first one's tag.
 *
 * Both providers render implicitly into every container on the page when their script loads; a
 * container mounted after that (a second block appearing later, a client-side navigation) is
 * rendered explicitly through the provider's global. The widget posts its token as a hidden input
 * inside the container — so inside the form — named after the provider, which the storefront
 * handler forwards as `captchaToken`.
 */

export type CaptchaProvider = 'turnstile' | 'hcaptcha';

export const CAPTCHA_SCRIPT_URLS: Readonly<Record<CaptchaProvider, string>> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
  hcaptcha: 'https://js.hcaptcha.com/1/api.js',
};

/** The class the provider's implicit render looks for. */
export const CAPTCHA_CONTAINER_CLASSES: Readonly<Record<CaptchaProvider, string>> = {
  turnstile: 'cf-turnstile',
  hcaptcha: 'h-captcha',
};

/** The posted name of the provider's token. */
export const CAPTCHA_RESPONSE_FIELDS: Readonly<Record<CaptchaProvider, string>> = {
  turnstile: 'cf-turnstile-response',
  hcaptcha: 'h-captcha-response',
};

/** What both providers' globals offer, as far as the block uses them. */
interface CaptchaGlobal {
  render(container: HTMLElement, options: { sitekey: string }): unknown;
  reset(widget?: unknown): void;
}

const GLOBAL_NAMES: Readonly<Record<CaptchaProvider, string>> = { turnstile: 'turnstile', hcaptcha: 'hcaptcha' };

/** The provider's global, once its script has run. */
function providerGlobal(provider: CaptchaProvider): CaptchaGlobal | undefined {
  const candidate = (globalThis as Record<string, unknown>)[GLOBAL_NAMES[provider]];
  return candidate && typeof (candidate as CaptchaGlobal).render === 'function' ? (candidate as CaptchaGlobal) : undefined;
}

/** The marker a block's script tag carries, so the next block finds it. */
const SCRIPT_MARKER = 'data-cmsc-captcha';

/**
 * Requests the provider's script once per page; renders the widget into `container` when the script
 * already ran (a later mount). Returns the widget handle the provider answered, if any.
 */
export function mountCaptcha(provider: CaptchaProvider, siteKey: string, container: HTMLElement | null): unknown {
  const loaded = providerGlobal(provider);
  if (loaded) {
    // The script already scanned the page: this container is new to it. One widget per container.
    if (!container || container.childElementCount > 0) return undefined;
    return loaded.render(container, { sitekey: siteKey });
  }
  if (!document.querySelector(`script[${SCRIPT_MARKER}="${provider}"]`)) {
    const script = document.createElement('script');
    script.src = CAPTCHA_SCRIPT_URLS[provider];
    script.async = true;
    script.defer = true;
    script.setAttribute(SCRIPT_MARKER, provider);
    document.head.appendChild(script);
  }
  return undefined;
}

/** A token is good for one check: after a refusal the shopper solves a fresh one. */
export function resetCaptcha(provider: CaptchaProvider, widget: unknown): void {
  try {
    providerGlobal(provider)?.reset(widget ?? undefined);
  } catch {
    // A widget the provider no longer knows: nothing to reset.
  }
}
