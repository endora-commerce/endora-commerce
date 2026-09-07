import { describe, expect, it } from 'vitest';
import {
  refuseForbiddenAddresses,
  validateDeliveryTargetUrl,
} from './delivery-target-url.js';

/**
 * Feature 070 / SR-2, SR-4, AS-4 — the delivery egress guard.
 *
 * Delivery deliberately does what FR-091 forbids elsewhere: it sends
 * credentials to an operator-nominated host. So the guard is tested as a guard —
 * every refusal below is a case somebody would otherwise use to make this
 * platform read its own cloud metadata endpoint and post the answer to a server
 * they control.
 *
 * Nothing here touches the network: the URL rules are pure, and address
 * classification is handed a list rather than resolving one.
 */

describe('validateDeliveryTargetUrl (shape)', () => {
  it('accepts an https URL with a path and a query — a partner ingest endpoint', () => {
    const verdict = validateDeliveryTargetUrl('https://partner.example/v2/feeds?shop=42');
    expect(verdict.ok).toBe(true);
    expect(verdict.ok === true && verdict.url.pathname).toBe('/v2/feeds');
  });

  it('refuses http:// — the authenticating headers ride on this request (SR-4)', () => {
    const verdict = validateDeliveryTargetUrl('http://partner.example/feeds');
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('scheme');
    // The message has to name the fix, not the rule.
    expect(verdict.ok === false && verdict.detail).toContain('https://');
  });

  it('refuses a userinfo URL and says where the password belongs instead', () => {
    const verdict = validateDeliveryTargetUrl('https://user:pass@partner.example/feeds');
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('credentials');
    expect(verdict.ok === false && verdict.detail).toContain('header');
  });

  it('refuses a fragment and an empty host', () => {
    expect(validateDeliveryTargetUrl('https://partner.example/feeds#part').ok).toBe(false);
    expect(validateDeliveryTargetUrl('https://').ok).toBe(false);
  });

  it('refuses anything unparseable and any non-https scheme', () => {
    expect(validateDeliveryTargetUrl('not a url').ok).toBe(false);
    expect(validateDeliveryTargetUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateDeliveryTargetUrl('ftp://partner.example/feeds').ok).toBe(false);
  });
});

describe('validateDeliveryTargetUrl (literal addresses) — AS-4', () => {
  it('refuses the cloud metadata endpoint by literal, naming the address', () => {
    const verdict = validateDeliveryTargetUrl('https://169.254.169.254/latest/meta-data/');
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('address');
    expect(verdict.ok === false && verdict.detail).toContain('169.254.169.254');
  });

  it('refuses loopback, RFC 1918 and CGNAT literals', () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '100.64.0.1']) {
      expect(validateDeliveryTargetUrl(`https://${host}/ingest`).ok).toBe(false);
    }
  });

  it('refuses an IPv4-mapped IPv6 literal — the standard way a naive check is walked around', () => {
    expect(validateDeliveryTargetUrl('https://[::ffff:169.254.169.254]/x').ok).toBe(false);
    expect(validateDeliveryTargetUrl('https://[::1]/x').ok).toBe(false);
  });

  it('accepts a public literal', () => {
    expect(validateDeliveryTargetUrl('https://93.184.216.34/ingest').ok).toBe(true);
  });
});

describe('refuseForbiddenAddresses', () => {
  it('accepts a host that resolves only to public addresses', () => {
    expect(refuseForbiddenAddresses('partner.example', ['93.184.216.34']).ok).toBe(true);
  });

  it('refuses when ANY resolved address is private — the split-horizon case', () => {
    const verdict = refuseForbiddenAddresses('partner.example', [
      '93.184.216.34',
      '169.254.169.254',
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.detail).toContain('169.254.169.254');
  });

  it('refuses a host that resolves to nothing rather than treating it as allowed', () => {
    expect(refuseForbiddenAddresses('partner.example', []).ok).toBe(false);
  });
});
