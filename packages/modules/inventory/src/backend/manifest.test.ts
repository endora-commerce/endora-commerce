import { describe, expect, it } from 'vitest';
import { INVENTORY_SETTING_CODES, manifest } from '../manifest.js';
import en from '../../i18n/en.json' with { type: 'json' };
import pl from '../../i18n/pl.json' with { type: 'json' };

// Issue #1335 — the recipient's description said an empty value falls back to
// the platform admin; `LowStockAlertService.resolveRecipient` falls back to the
// `INVENTORY_LOW_STOCK_RECIPIENT` environment variable, and sends nothing when
// that is unset too.
describe('inventory manifest — the low-stock recipient description', () => {
  const code = INVENTORY_SETTING_CODES.LOW_STOCK_ALERT_RECIPIENT_EMAIL;
  const declared = (manifest.settings?.settings ?? []).find((s) => s.code === code);
  const key = `settingLabels.${code}.description`;
  const descriptions = [
    ['manifest', declared?.description],
    ['en bundle', (en as Record<string, string>)[key]],
    ['pl bundle', (pl as Record<string, string>)[key]],
  ] as const;

  it.each(descriptions)('the %s description names the environment fallback', (_where, text) => {
    expect(text).toMatch(/INVENTORY_LOW_STOCK_RECIPIENT/);
  });

  it.each(descriptions)('the %s description does not promise the platform admin', (_where, text) => {
    expect(text).not.toMatch(/platform admin|administrator/i);
  });

  it('labels the setting in both languages', () => {
    for (const bundle of [en, pl] as Record<string, string>[]) {
      expect(bundle[`settingLabels.${code}.name`]).toBeTruthy();
    }
  });
});
