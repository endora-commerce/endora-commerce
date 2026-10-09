import { describe, expect, it } from 'vitest';
import type {
  AdminAuthenticationAttempt,
  AdminAuthenticationThrottlePort,
} from '@endora-commerce/contracts';
import { createSecondFactorVerifier } from './second-factor-verifier.js';

function recordingThrottle(): {
  throttle: Pick<AdminAuthenticationThrottlePort, 'verify'>;
  attempts: () => AdminAuthenticationAttempt[];
  results: () => unknown[];
} {
  const attempts: AdminAuthenticationAttempt[] = [];
  const results: unknown[] = [];
  return {
    throttle: {
      verify: async (attempt, check) => {
        attempts.push(attempt);
        const result = await check();
        results.push(result);
        return result.ok;
      },
    },
    attempts: () => attempts,
    results: () => results,
  };
}

describe('createSecondFactorVerifier', () => {
  it('checks an administrator code inside the throttle, keyed by the administrator id', async () => {
    const { throttle, attempts, results } = recordingThrottle();
    const verify = createSecondFactorVerifier(
      async () => ({ ok: true, factor: 'recovery' as const }),
      throttle,
    );

    const result = await verify({ subjectType: 'admin', subjectId: 'a-1' }, '123456', {
      ip: '203.0.113.9',
      knownDevice: 'v1.a-1.device.stamp',
    });

    expect(result).toEqual({ ok: true, factor: 'recovery' });
    expect(attempts()).toEqual([
      {
        factor: 'second_factor',
        account: 'a-1',
        ip: '203.0.113.9',
        knownDevice: 'v1.a-1.device.stamp',
      },
    ]);
    expect(results()).toEqual([{ ok: true, adminUserId: 'a-1' }]);
  });

  it('answers the failed check, which the throttle has counted', async () => {
    const { throttle, results } = recordingThrottle();
    const verify = createSecondFactorVerifier(async () => ({ ok: false }), throttle);

    await expect(verify({ subjectType: 'admin', subjectId: 'a-1' }, '000000')).resolves.toEqual({
      ok: false,
    });
    expect(results()).toEqual([{ ok: false, adminUserId: 'a-1' }]);
  });

  it('passes the refusal on without looking at the code', async () => {
    const refusal = new Error('throttled');
    let looked = false;
    const verify = createSecondFactorVerifier(
      async () => {
        looked = true;
        return { ok: true };
      },
      {
        verify: async () => {
          throw refusal;
        },
      },
    );

    await expect(verify({ subjectType: 'admin', subjectId: 'a-1' }, '123456')).rejects.toBe(refusal);
    expect(looked).toBe(false);
  });

  it('leaves a customer code outside the administrator throttle', async () => {
    const { throttle, attempts } = recordingThrottle();
    const verify = createSecondFactorVerifier(async () => ({ ok: true, factor: 'totp' as const }), throttle);

    await expect(verify({ subjectType: 'customer', subjectId: 'c-1' }, '123456')).resolves.toEqual({
      ok: true,
      factor: 'totp',
    });
    expect(attempts()).toEqual([]);
  });
});
