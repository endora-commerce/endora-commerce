import { describe, expect, it, vi } from 'vitest';
import { reportingTimeZoneOf } from './reporting-time-zone.js';

/**
 * Which calendar CRM analytics count days in (issue #474): the `analytics`
 * module's `analytics.reporting_time_zone` while that module is present, and
 * `UTC` while it is not — decided before the gated port is touched, so an
 * absent owner degrades the figures and never fails them.
 */
describe('the reporting time zone CRM counts in', () => {
  it('is the analytics setting while analytics is present', async () => {
    const port = { timeZone: vi.fn(async () => 'Europe/Warsaw') };
    await expect(reportingTimeZoneOf({ present: () => true, port })()).resolves.toBe('Europe/Warsaw');
  });

  it('is UTC while analytics is absent, without touching its port', async () => {
    const port = { timeZone: vi.fn(async () => { throw new Error('MODULE_DISABLED'); }) };
    await expect(reportingTimeZoneOf({ present: () => false, port })()).resolves.toBe('UTC');
    expect(port.timeZone).not.toHaveBeenCalled();
  });

  it('asks for presence on every call, so switching analytics on or off needs no restart', async () => {
    let present = false;
    const port = { timeZone: vi.fn(async () => 'Europe/Warsaw') };
    const read = reportingTimeZoneOf({ present: () => present, port });
    await expect(read()).resolves.toBe('UTC');
    present = true;
    await expect(read()).resolves.toBe('Europe/Warsaw');
  });
});
