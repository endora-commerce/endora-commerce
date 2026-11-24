import { randomInt } from 'node:crypto';
import type { GenerateCouponsRequest } from '@endora-commerce/contracts';

/**
 * The coupon-code generator (feature 045, US4). Its own file since issue
 * #1844, so the batch Command and `CouponService` both import it without
 * importing each other.
 */

/** Hard cap on a single generated batch (avoids a speculative queue, Principle X). */
export const COUPON_BATCH_MAX = 50_000;

const ALPHABETS: Record<GenerateCouponsRequest['format'], string> = {
  // Crockford-ish alphabet — no ambiguous I/O/0/1.
  alnum: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  digits: '0123456789',
  letters: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
};

function randomBody(length: number, alphabet: string): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function insertDashes(body: string, every: number): string {
  if (!every || every <= 0) return body;
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += every) parts.push(body.slice(i, i + every));
  return parts.join('-');
}

export function buildCouponCode(req: GenerateCouponsRequest): string {
  const body = insertDashes(randomBody(req.length, ALPHABETS[req.format]), req.dashEvery ?? 0);
  return `${req.prefix ?? ''}${body}${req.suffix ?? ''}`;
}
