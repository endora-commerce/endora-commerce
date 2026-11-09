import { describe, expect, it } from 'vitest';
import { RETURNS_SETTING_CODES, manifest } from '../../manifest.js';
import { createReturnsTimeZoneValidator, isKnownTimeZone } from './time-zone-validator.js';

/**
 * Issue #905 (PR 1, design D3.4) — `returns.time_zone`, the zone the
 * free-return window and the withdrawal period count calendar days in.
 */
describe('returns.time_zone', () => {
  it('is declared in the manifest as a string defaulting to Europe/Warsaw', () => {
    expect(RETURNS_SETTING_CODES.TIME_ZONE).toBe('returns.time_zone');
    const declared = manifest.settings?.settings.find((s) => s.code === 'returns.time_zone');
    expect(declared).toMatchObject({ groupCode: 'returns', valueType: 'string', defaultValue: 'Europe/Warsaw' });
  });

  it('knows IANA zones and UTC, and refuses anything else', () => {
    for (const zone of ['Europe/Warsaw', 'America/New_York', 'UTC']) {
      expect(isKnownTimeZone(zone), zone).toBe(true);
    }
    for (const value of ['', 'Mars/Olympus_Mons', 'europe/warsaw ', 42, null]) {
      expect(isKnownTimeZone(value), String(value)).toBe(false);
    }
  });

  it('answers for its one setting and refuses an unknown zone with 422', async () => {
    const validator = createReturnsTimeZoneValidator();
    expect(validator).toMatchObject({ contributorModuleId: 'returns', codes: ['returns.time_zone'] });
    const input = (proposedValue: unknown) => ({
      code: 'returns.time_zone',
      ownerModuleId: 'returns',
      proposedValue,
      projection: [],
      targetedChannelIds: [],
    });
    await expect(validator.validate(input('Europe/Warsaw'))).resolves.toBeUndefined();
    await expect(validator.validate(input('Mars/Olympus_Mons'))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
  });
});
