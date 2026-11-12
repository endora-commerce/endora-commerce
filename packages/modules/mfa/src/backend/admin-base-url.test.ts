import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';
import { mfaBaseUrlsFromEnvironment, type MfaBaseUrls } from './index.js';

/**
 * `mfa` reads the Admin UI's address from the platform and no longer owns it
 * (issue #185).
 *
 * `ADMIN_BASE_URL` was this module's environment input, which left every other
 * module that mails an administrator without a sanctioned way to link into the
 * admin. The platform declares it now and `configuredAdminBaseUrl` is the one
 * reader, so `mfa` takes the platform's answer — including its refusal of a
 * malformed value — rather than the raw variable.
 */

const ORIGINAL = process.env['ADMIN_BASE_URL'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['ADMIN_BASE_URL'];
  else process.env['ADMIN_BASE_URL'] = ORIGINAL;
});

function adminBaseUrl(raw: string | undefined): MfaBaseUrls['admin'] {
  if (raw === undefined) delete process.env['ADMIN_BASE_URL'];
  else process.env['ADMIN_BASE_URL'] = raw;
  return mfaBaseUrlsFromEnvironment().admin;
}

describe('mfa and the Admin UI base address', () => {
  it('does not declare ADMIN_BASE_URL — the platform owns it', () => {
    expect((manifest.env ?? []).map((input) => input.name)).not.toContain('ADMIN_BASE_URL');
  });

  it("takes the platform's normalised address", () => {
    expect(adminBaseUrl('https://shop.example.com/admin/')).toBe('https://shop.example.com/admin');
  });

  it('treats an unset or malformed address as absent, so its own fallback applies', () => {
    expect(adminBaseUrl(undefined)).toBeUndefined();
    expect(adminBaseUrl('admin.example.com')).toBeUndefined();
  });
});
