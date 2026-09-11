import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { Actor } from '@endora-commerce/contracts';
import { callingCustomerAccountId } from './request-actor.js';

/**
 * The drain of `PwaBridge.resolveCustomerAccountId`
 * (`specs/110-instance-repository/` T118c).
 *
 * The three kinds a storefront subscribe request can carry, and the one thing
 * that matters about them: only a customer owns a device. `api_key` is in the
 * set on purpose — it is the shape a `null` answer would look wrong for if this
 * were ever rewritten as "not anonymous".
 */
const asRequest = (actor: Actor): FastifyRequest => ({ actor }) as FastifyRequest;

describe('pwa — who owns a push subscription', () => {
  it('names the signed-in customer', () => {
    expect(
      callingCustomerAccountId(
        asRequest({ kind: 'customer', customerAccountId: 'cust-1', organizationId: 'org-1' }),
      ),
    ).toBe('cust-1');
  });

  it('answers null for an anonymous shopper, whose device is registered all the same', () => {
    expect(callingCustomerAccountId(asRequest({ kind: 'anonymous' }))).toBeNull();
  });

  it('answers null for an admin', () => {
    expect(
      callingCustomerAccountId(asRequest({ kind: 'admin', adminUserId: 'admin-1' })),
    ).toBeNull();
  });
});
