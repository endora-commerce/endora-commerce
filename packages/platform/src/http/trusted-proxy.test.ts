// Issue #220 — the trusted-proxy configuration parser.
//
// The parser is the whole security surface of the option: `trustProxy: true`
// tells Fastify to believe any `X-Forwarded-For` a client sends, which behind a
// single nginx is a spoofable client IP on every audit row and every rate-limit
// bucket. So the accepted vocabulary has no spelling for "trust everything",
// and a value it cannot make sense of is refused rather than quietly downgraded
// to "trust nothing" — an operator who mistypes the variable would otherwise
// get today's broken behaviour and no signal.

import { describe, expect, it } from 'vitest';

import {
  parseTrustedProxy,
  TrustedProxyConfigError,
} from './trusted-proxy.js';

describe('parseTrustedProxy', () => {
  describe('the default changes nothing', () => {
    it('returns undefined when neither variable is set', () => {
      expect(parseTrustedProxy({})).toBeUndefined();
    });

    it('treats blank and whitespace-only values as unset', () => {
      expect(parseTrustedProxy({ hops: '', addresses: '' })).toBeUndefined();
      expect(parseTrustedProxy({ hops: '   ', addresses: '\t' })).toBeUndefined();
    });
  });

  describe('hop counts', () => {
    it('accepts a positive integer', () => {
      expect(parseTrustedProxy({ hops: '1' })).toBe(1);
      expect(parseTrustedProxy({ hops: ' 2 ' })).toBe(2);
    });

    it('refuses zero — it reads as "trust nothing" but means "trust the socket"', () => {
      expect(() => parseTrustedProxy({ hops: '0' })).toThrow(TrustedProxyConfigError);
    });

    it('refuses a negative, a fraction and a non-number', () => {
      for (const hops of ['-1', '1.5', 'one', 'true', '1,2']) {
        expect(() => parseTrustedProxy({ hops })).toThrow(TrustedProxyConfigError);
      }
    });

    it('refuses an implausible hop count', () => {
      expect(() => parseTrustedProxy({ hops: '99' })).toThrow(TrustedProxyConfigError);
    });
  });

  describe('trusted addresses', () => {
    it('accepts a single IPv4 address', () => {
      expect(parseTrustedProxy({ addresses: '10.0.0.1' })).toEqual(['10.0.0.1']);
    });

    it('accepts a comma-separated list with CIDR notation', () => {
      expect(parseTrustedProxy({ addresses: '127.0.0.1, 10.0.0.0/8' })).toEqual([
        '127.0.0.1',
        '10.0.0.0/8',
      ]);
    });

    it('accepts IPv6 addresses and prefixes', () => {
      expect(parseTrustedProxy({ addresses: '::1,fd00::/8' })).toEqual(['::1', 'fd00::/8']);
    });

    it("accepts proxy-addr's named ranges", () => {
      expect(parseTrustedProxy({ addresses: 'loopback' })).toEqual(['loopback']);
      expect(parseTrustedProxy({ addresses: 'linklocal, uniquelocal' })).toEqual([
        'linklocal',
        'uniquelocal',
      ]);
    });

    it('refuses every spelling of "trust the whole internet"', () => {
      for (const addresses of ['*', 'true', 'all', '0.0.0.0/0', '::/0']) {
        expect(() => parseTrustedProxy({ addresses })).toThrow(TrustedProxyConfigError);
      }
    });

    it('refuses a hostname — proxy-addr matches addresses, and a name silently matches nothing', () => {
      expect(() => parseTrustedProxy({ addresses: 'nginx' })).toThrow(TrustedProxyConfigError);
    });

    it('refuses a malformed address or prefix length', () => {
      for (const addresses of ['10.0.0.256', '10.0.0.0/33', '10.0.0.0/', 'fd00::/129']) {
        expect(() => parseTrustedProxy({ addresses })).toThrow(TrustedProxyConfigError);
      }
    });
  });

  it('refuses both variables at once rather than picking a winner', () => {
    expect(() => parseTrustedProxy({ hops: '1', addresses: '10.0.0.1' })).toThrow(
      TrustedProxyConfigError,
    );
  });

  it('names both variables in the failure message, so the operator can find them', () => {
    let message = '';
    try {
      parseTrustedProxy({ hops: 'yes' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('TRUSTED_PROXY_HOPS');
  });
});
