import type { ReportingTimeZonePort } from '@endora-commerce/contracts';

/** The calendar analytics count in when `analytics` is absent. */
export const FALLBACK_REPORTING_TIME_ZONE = 'UTC';

/**
 * The reporting time zone CRM analytics count days in (issue #474; owner
 * ruling of 2026-10-27): `analytics.reporting_time_zone`, which the
 * `analytics` module owns and serves through its gated
 * `reportingTimeZonePort`. Presence is decided first (the manifest's
 * `degrades-without` edge): with `analytics` off or absent the figures are
 * counted in `UTC`, and the port is not touched.
 *
 * The same reader as Projects' `reporting-time-zone.ts`, written again here —
 * a module may not import another module's internals.
 */
export function reportingTimeZoneOf(deps: {
  /** Whether `analytics` is effectively present — asked per call. */
  present: () => boolean;
  /** `reportingTimeZonePort` — lazy; called only after `present()`. */
  port: ReportingTimeZonePort;
}): () => Promise<string> {
  return async () => (deps.present() ? deps.port.timeZone() : FALLBACK_REPORTING_TIME_ZONE);
}
