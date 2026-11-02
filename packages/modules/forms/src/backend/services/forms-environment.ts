import { FORMS_SETTING_CODES } from '@endora-commerce/contracts';
import type { SalesChannelResolutionPort, SettingsReadPort } from '@endora-commerce/platform/kernel';
import type { CaptchaSettings } from './form-warnings.js';

/**
 * What a form read depends on beyond the form (`specs/170-forms-module/` data-model §7): the active
 * sales channels with their languages, and the CAPTCHA settings. Read per call through the ports —
 * a channel or a setting changed by an operator is the next read's answer.
 */
export interface FormsEnvironment {
  /** Active channels only; the system default is flagged. */
  readonly channels: readonly {
    readonly id: string;
    readonly languages: readonly string[];
    readonly defaultLanguage: string;
    readonly systemDefault: boolean;
  }[];
  readonly captcha: CaptchaSettings;
}

export type FormsEnvironmentReader = () => Promise<FormsEnvironment>;

function text(value: { ok: true; value: unknown } | { ok: false } | undefined): string {
  return value && value.ok && typeof value.value === 'string' ? value.value : '';
}

/**
 * The CAPTCHA settings, platform-wide (data-model §6), read through `settingsReadPort` on every call.
 * A setting that is unset or unreadable reads as empty, so a broken one leaves CAPTCHA unconfigured.
 */
export async function readCaptchaSettings(settings: Pick<SettingsReadPort, 'getMany'>): Promise<CaptchaSettings> {
  const values = await settings.getMany(
    [FORMS_SETTING_CODES.CAPTCHA_PROVIDER, FORMS_SETTING_CODES.CAPTCHA_SITE_KEY, FORMS_SETTING_CODES.CAPTCHA_SECRET_KEY],
    null,
  );
  return {
    provider: text(values.get(FORMS_SETTING_CODES.CAPTCHA_PROVIDER)) || 'none',
    siteKey: text(values.get(FORMS_SETTING_CODES.CAPTCHA_SITE_KEY)),
    secretKey: text(values.get(FORMS_SETTING_CODES.CAPTCHA_SECRET_KEY)),
  };
}

export function createFormsEnvironmentReader(ports: {
  readonly channels: Pick<SalesChannelResolutionPort, 'listAll'>;
  readonly settings: Pick<SettingsReadPort, 'getMany'>;
}): FormsEnvironmentReader {
  return async () => {
    const [channels, captcha] = await Promise.all([ports.channels.listAll(), readCaptchaSettings(ports.settings)]);
    return {
      channels: channels
        .filter((channel) => channel.active)
        .map((channel) => ({
          id: channel.id,
          languages: [...channel.languages],
          defaultLanguage: channel.defaultLanguage,
          systemDefault: channel.systemDefault,
        })),
      captcha,
    };
  };
}
