import { afterEach, describe, expect, it } from 'vitest';
import { PLATFORM_ENVIRONMENT_INPUTS } from '../env/index.js';
import { composeApp } from '../composition/compose-app.js';
import {
  AdminBaseUrlMalformedError,
  assertAdminBaseUrlWellFormed,
  configuredAdminBaseUrl,
} from './admin-base-url.js';

/**
 * The Admin UI's base address has one owner, the platform (issue #185).
 *
 * It used to be `mfa`'s environment input, and its ledger entry said that a
 * second module needing the admin's address moves the input to the platform
 * rather than declaring it again. CRM, Tasks and the RFQ notifications all
 * mail an administrator, so the address is read through this one accessor.
 *
 * The rule a consumer builds on: an absent address is `null`, so a link into
 * the admin is omitted rather than broken. A set but malformed one refuses the
 * boot (architect ruling on #1078): a relative or scheme-less value would
 * produce links that open nothing, and an operator who set it meant something.
 */
describe('configuredAdminBaseUrl', () => {
  it('is null when the variable is unset or blank — never a localhost guess', () => {
    expect(configuredAdminBaseUrl(undefined)).toBeNull();
    expect(configuredAdminBaseUrl('')).toBeNull();
    expect(configuredAdminBaseUrl('   ')).toBeNull();
  });

  it('returns an absolute http(s) address without its trailing slashes', () => {
    expect(configuredAdminBaseUrl('https://admin.example.com')).toBe('https://admin.example.com');
    expect(configuredAdminBaseUrl(' https://admin.example.com/ ')).toBe(
      'https://admin.example.com',
    );
    expect(configuredAdminBaseUrl('http://localhost:3002//')).toBe('http://localhost:3002');
  });

  it('keeps a base path, because an admin served under one is addressed with it', () => {
    expect(configuredAdminBaseUrl('https://shop.example.com/admin/')).toBe(
      'https://shop.example.com/admin',
    );
  });

  it.each([
    ['a host without a scheme', 'admin.example.com'],
    ['a path', '/admin'],
    ['another scheme', 'ftp://admin.example.com'],
    ['a query', 'https://admin.example.com/?x=1'],
    ['a fragment', 'https://admin.example.com/#/home'],
    ['not a URL at all', 'http://'],
  ])('is null for %s, so a link is omitted rather than broken', (_label, raw) => {
    expect(configuredAdminBaseUrl(raw)).toBeNull();
  });
});

describe('assertAdminBaseUrlWellFormed', () => {
  it('accepts an unset, blank or well-formed address', () => {
    expect(() => assertAdminBaseUrlWellFormed(undefined)).not.toThrow();
    expect(() => assertAdminBaseUrlWellFormed('')).not.toThrow();
    expect(() => assertAdminBaseUrlWellFormed('https://admin.example.com/')).not.toThrow();
  });

  it.each(['admin.example.com', '/admin', 'https://admin.example.com/?x=1'])(
    'refuses %s, naming the variable, the value and the rule',
    (raw) => {
      let thrown: unknown;
      try {
        assertAdminBaseUrlWellFormed(raw);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AdminBaseUrlMalformedError);
      const message = (thrown as Error).message;
      expect(message).toContain('ADMIN_BASE_URL');
      expect(message).toContain(raw);
      expect(message).toContain('absolute http(s) URL');
      expect(message).toContain('no query or fragment');
    },
  );
});

describe('composeApp and a malformed ADMIN_BASE_URL', () => {
  const original = process.env['ADMIN_BASE_URL'];
  afterEach(() => {
    if (original === undefined) delete process.env['ADMIN_BASE_URL'];
    else process.env['ADMIN_BASE_URL'] = original;
  });

  it('refuses to boot in every environment, before anything is opened', async () => {
    process.env['ADMIN_BASE_URL'] = 'admin.example.com';
    await expect(
      composeApp({ deploymentRoot: '/nonexistent-deployment-root' }),
    ).rejects.toBeInstanceOf(AdminBaseUrlMalformedError);
  });
});

describe('the platform declares ADMIN_BASE_URL', () => {
  it('as an optional, platform-owned address of the admin read by the backend', () => {
    const declared = PLATFORM_ENVIRONMENT_INPUTS.filter((input) => input.name === 'ADMIN_BASE_URL');
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatchObject({
      owner: { kind: 'platform' },
      consumers: ['backend'],
      addressOf: 'admin',
      secret: false,
      generable: false,
      requirement: { kind: 'optional' },
    });
  });
});
