import {
  ANALYTICS_REPORTING_TIME_ZONE_SETTING,
  ERROR_CODES,
  isIanaTimeZone,
  type ReportingTimeZonePort,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { z } from 'zod';

/**
 * The reporting time zone (owner decisions 2026-10-27, issue #465):
 * `analytics.reporting_time_zone`, the calendar reports count days in. This
 * module owns it so that no single reporting module does — Projects and CRM
 * analytics read it (#474).
 */

/** A zone the runtime does not know would make every report counted in it fail. */
export function createReportingTimeZoneValidator(): SettingWriteValidator {
  return {
    contributorModuleId: 'analytics',
    codes: [ANALYTICS_REPORTING_TIME_ZONE_SETTING],
    validate: async (input) => {
      if (!isIanaTimeZone(input.proposedValue)) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'The time zone must be an IANA time zone name, such as Europe/Warsaw, or UTC.',
        );
      }
    },
  };
}

const timeZoneSchema = z.string().min(1);

/** `reportingTimeZonePort` — the setting, platform-wide. */
export function createReportingTimeZonePort(settings: Pick<SettingsReadPort, 'get'>): ReportingTimeZonePort {
  return {
    timeZone: () => settings.get(ANALYTICS_REPORTING_TIME_ZONE_SETTING, null, timeZoneSchema),
  };
}
