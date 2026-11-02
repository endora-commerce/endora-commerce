import { textCompleteness, type FormDefinition, type FormWarning } from '@endora-commerce/contracts';

/**
 * The builder's warnings (`specs/170-forms-module/` FR-018, data-model §7): what an operator is told
 * about a form before it misbehaves on the storefront. **Never a reason to refuse a publish** — a form
 * without recipients still collects entries, a form asking for an unconfigured CAPTCHA is served
 * unprotected, an untranslated text falls back to the default language.
 *
 * Derived per read, never stored: the recipients are live, the CAPTCHA configuration is a setting
 * and the storefront languages are the active channels' — each can change without the form.
 */

export interface FormWarningsInput {
  /** The working copy. */
  readonly definition: FormDefinition;
  /** The version shoppers are served, when there is one. */
  readonly publishedDefinition: FormDefinition | null;
  readonly defaultLanguage: string;
  readonly recipients: readonly string[];
  readonly channelRecipients: Readonly<Record<string, readonly string[]>>;
}

export interface FormWarningsEnvironment {
  /** The active sales channels and the languages each serves. */
  readonly channels: readonly { readonly id: string; readonly languages: readonly string[] }[];
  /** Whether a CAPTCHA provider is chosen and both its keys are set (`isCaptchaConfigured`). */
  readonly captchaConfigured: boolean;
}

/** The CAPTCHA settings as `settingsReadPort` answers them (data-model §6). */
export interface CaptchaSettings {
  readonly provider: string;
  readonly siteKey: string;
  readonly secretKey: string;
}

/** A provider other than `none` and both keys present: only then can a check run (R-14). */
export function isCaptchaConfigured(settings: CaptchaSettings): boolean {
  return settings.provider !== 'none' && settings.siteKey.trim() !== '' && settings.secretKey.trim() !== '';
}

/** Every storefront language an active channel serves, once each, sorted. */
export function storefrontLanguages(channels: FormWarningsEnvironment['channels']): string[] {
  return [...new Set(channels.flatMap((channel) => channel.languages))].sort();
}

/**
 * `no_recipients`, then `captcha_not_configured`, then one `untranslated` per incomplete language.
 *
 * An override **replaces** the default list on its channel (A-2), so a channel is covered by its own
 * list when it has one and by the default otherwise; with no active channel the default alone decides.
 */
export function formWarnings(input: FormWarningsInput, environment: FormWarningsEnvironment): FormWarning[] {
  const warnings: FormWarning[] = [];

  const listFor = (channelId: string): readonly string[] => input.channelRecipients[channelId] ?? input.recipients;
  const uncovered =
    environment.channels.length === 0
      ? input.recipients.length === 0
      : environment.channels.some((channel) => listFor(channel.id).length === 0);
  if (uncovered) warnings.push({ code: 'no_recipients' });

  const asksForCaptcha =
    input.definition.behaviour.captchaRequired || (input.publishedDefinition?.behaviour.captchaRequired ?? false);
  if (asksForCaptcha && !environment.captchaConfigured) warnings.push({ code: 'captcha_not_configured' });

  for (const { language, missing } of textCompleteness(
    input.definition,
    storefrontLanguages(environment.channels),
    input.defaultLanguage,
  )) {
    if (missing.length > 0) warnings.push({ code: 'untranslated', language, missing: missing.length });
  }
  return warnings;
}
