import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertMethodsOfferedInChannel, type MethodChannelReads } from './method-channel-gate.js';

/**
 * The gate in isolation: which answer of the two method modules refuses, with
 * what, and which does not. The placement-level proof — over the real ports,
 * for the storefront, the preview and admin order creation — is
 * `backend/test/contract/orders/place-order-method-channel.test.ts`.
 */
const CHANNEL = 'channel-a';

function reads(answers: { delivery?: boolean | 'absent'; payment?: boolean | 'absent' }): {
  reads: MethodChannelReads;
  asked: string[];
} {
  const asked: string[] = [];
  const port = (
    name: string,
    answer: boolean | 'absent' | undefined,
  ): (() => { isAvailableInChannel(id: string, channel: string): Promise<boolean> } | null) => {
    return () =>
      answer === 'absent'
        ? null
        : {
            isAvailableInChannel: async (id, channel) => {
              asked.push(`${name}:${id}:${channel}`);
              return answer ?? true;
            },
          };
  };
  return {
    reads: {
      deliveryMethodRead: port('delivery', answers.delivery),
      paymentMethodRead: port('payment', answers.payment),
    },
    asked,
  };
}

async function refusalOf(run: Promise<void>): Promise<HttpError> {
  const error = await run.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe('assertMethodsOfferedInChannel', () => {
  it('passes when both owners say the method is offered in the channel', async () => {
    const { reads: r, asked } = reads({ delivery: true, payment: true });

    await expect(
      assertMethodsOfferedInChannel(r, {
        salesChannelId: CHANNEL,
        deliveryMethodId: 'd1',
        paymentMethodId: 'p1',
      }),
    ).resolves.toBeUndefined();
    expect(asked).toEqual([`delivery:d1:${CHANNEL}`, `payment:p1:${CHANNEL}`]);
  });

  it('refuses a delivery method its owner says the channel does not offer', async () => {
    const { reads: r } = reads({ delivery: false, payment: true });

    const error = await refusalOf(
      assertMethodsOfferedInChannel(r, {
        salesChannelId: CHANNEL,
        deliveryMethodId: 'd1',
        paymentMethodId: 'p1',
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details).toEqual({
      code: 'delivery_method_not_in_sales_channel',
      deliveryMethodId: 'd1',
      salesChannelId: CHANNEL,
    });
  });

  it('refuses a payment method its owner says the channel does not offer', async () => {
    const { reads: r } = reads({ delivery: true, payment: false });

    const error = await refusalOf(
      assertMethodsOfferedInChannel(r, {
        salesChannelId: CHANNEL,
        deliveryMethodId: 'd1',
        paymentMethodId: 'p1',
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual({
      code: 'payment_method_not_in_sales_channel',
      paymentMethodId: 'p1',
      salesChannelId: CHANNEL,
    });
  });

  it('asks only about the methods it is given', async () => {
    const { reads: r, asked } = reads({ delivery: false, payment: false });

    await expect(
      assertMethodsOfferedInChannel(r, { salesChannelId: CHANNEL }),
    ).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });

  /**
   * An absent owner is not this gate's refusal: the caller resolved the method
   * through the same port first, and an absent port already refused there.
   */
  it('does not turn an absent owner into a refusal of its own', async () => {
    const { reads: r } = reads({ delivery: 'absent', payment: 'absent' });

    await expect(
      assertMethodsOfferedInChannel(r, {
        salesChannelId: CHANNEL,
        deliveryMethodId: 'd1',
        paymentMethodId: 'p1',
      }),
    ).resolves.toBeUndefined();
  });
});
