import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `specs/170-organization-roles/` WP-16 (T158; FR-031, FR-057) — since roles,
 * a basket needs approval because the buyer's **role** lacks
 * `carts.order_without_approval`, and an approver is anyone whose role holds
 * `carts.approve`, not the Organization's administrator. Placement's three
 * `ORDER_CART_APPROVAL_REQUIRED` sentences say so in the owner-accepted words
 * the storefront's cart banner already uses (WP-10): *an approver in your
 * organization* and *your role requires approval of this cart*.
 */

const bundle = (language: 'en' | 'pl') =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../../i18n/${language}.json`), 'utf8')) as Record<
    string,
    string
  >;

const TOKENS = ['cart_approval_not_submitted', 'cart_approval_pending', 'cart_approval_rejected'] as const;
const key = (token: (typeof TOKENS)[number]) => `errors.ORDER_CART_APPROVAL_REQUIRED.${token}`;

describe('ORDER_CART_APPROVAL_REQUIRED sentences follow the role, not the administrator (170 WP-16)', () => {
  const en = bundle('en');
  const pl = bundle('pl');

  it('names no administrator and no Organization-wide requirement', () => {
    for (const token of TOKENS) {
      expect(en[key(token)], `en ${token}`).not.toMatch(/administrator|your organization requires/i);
      expect(pl[key(token)], `pl ${token}`).not.toMatch(/administrator|organizacja wymaga/i);
    }
  });

  it('en — the role requires approval; an approver in the organization decides', () => {
    expect(en[key('cart_approval_not_submitted')]).toMatch(/^Your role requires approval of this cart\b/);
    expect(en[key('cart_approval_pending')]).toContain('an approver in your organization');
    expect(en[key('cart_approval_rejected')]).toContain('an approver in your organization');
  });

  it('pl — the same, in the storefront’s Polish', () => {
    expect(pl[key('cart_approval_not_submitted')]).toMatch(/^Twoja rola wymaga akceptacji tego koszyka\b/);
    expect(pl[key('cart_approval_pending')]).toContain('osoby zatwierdzającej w Twojej organizacji');
    expect(pl[key('cart_approval_rejected')]).toContain('osobę zatwierdzającą w Twojej organizacji');
  });
});
