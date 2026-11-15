import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import type { AuthSessionPort, MfaLoginPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAuthService, type SignInLanguageCapture } from './customer-auth-service.js';

/**
 * Issue #652 (D-292) — a password sign-in fills an account's unknown preferred
 * language from the sign-in request, after the password, the block and the
 * channel access have been accepted and **before** the second-factor branch,
 * so a sign-in that goes on to a second factor captures too. A refused
 * sign-in captures nothing, a known language is never overwritten, and a
 * capture that fails is logged and never fails the sign-in.
 */
const PASSWORD = 'correct horse battery staple';

async function buyer(overrides: Partial<CustomerAccount> = {}): Promise<Partial<CustomerAccount>> {
  return {
    id: 'c-652',
    organizationId: 'o-652',
    email: 'buyer652@example.test',
    passwordHash: await hashPassword(PASSWORD),
    deletedAt: null,
    blockedAt: null,
    preferredLanguage: null,
    ...overrides,
  };
}

function entityManager(account: Partial<CustomerAccount>): EntityManager {
  return {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CustomerAccount) throw new Error('unexpected entity');
      return where['email'] === account.email ? account : null;
    },
    flush: async () => undefined,
  } as unknown as EntityManager;
}

const sessions = {
  createSession: async () => ({ cookieValue: 's.tok', expiresAt: new Date(0) }),
} as unknown as AuthSessionPort;

function recordingCapture(failure?: Error): SignInLanguageCapture & {
  captured: Array<[string, string]>;
  failures: unknown[];
} {
  const captured: Array<[string, string]> = [];
  const failures: unknown[] = [];
  return {
    captured,
    failures,
    captureIfUnset: async (customerAccountId, tag) => {
      if (failure) throw failure;
      captured.push([customerAccountId, tag]);
    },
    onFailure: (err) => {
      failures.push(err);
    },
  };
}

function service(
  account: Partial<CustomerAccount>,
  capture: SignInLanguageCapture,
  options: { mfa?: MfaLoginPort; channelRefuses?: boolean } = {},
): CustomerAuthService {
  const channelAccess = {
    assertCustomerMayUse: async () => {
      if (options.channelRefuses) throw new HttpError(403, 'SALES_CHANNEL_NOT_PERMITTED', 'no');
    },
  };
  return new CustomerAuthService(
    () => entityManager(account),
    sessions,
    options.mfa ? () => options.mfa : undefined,
    undefined,
    undefined,
    channelAccess,
    capture,
  );
}

const login = { email: 'buyer652@example.test', password: PASSWORD, salesChannelId: 'ch-1', language: 'pl-PL' };

describe('CustomerAuthService.login — preferred-language capture (#652)', () => {
  it('fills an unknown language from the sign-in', async () => {
    const capture = recordingCapture();
    const outcome = await service(await buyer(), capture).login(login);

    expect(outcome.status).toBe('authenticated');
    expect(capture.captured).toEqual([['c-652', 'pl-PL']]);
  });

  it('captures before the second factor is asked for', async () => {
    const capture = recordingCapture();
    const mfa = {
      beginLogin: vi.fn(async () => ({ kind: 'challenge', challengeId: 'ch' })),
    } as unknown as MfaLoginPort;

    const outcome = await service(await buyer(), capture, { mfa }).login(login);

    expect(outcome).toEqual({ status: 'mfaRequired', challengeId: 'ch' });
    expect(capture.captured).toEqual([['c-652', 'pl-PL']]);
  });

  it('never asks to overwrite a known language', async () => {
    const capture = recordingCapture();
    await service(await buyer({ preferredLanguage: 'en-US' }), capture).login(login);

    expect(capture.captured).toEqual([]);
  });

  it('captures nothing when the sign-in carries no language', async () => {
    const capture = recordingCapture();
    await service(await buyer(), capture).login({ ...login, language: null });

    expect(capture.captured).toEqual([]);
  });

  it('captures nothing on a wrong password, a blocked account or a refused channel', async () => {
    const capture = recordingCapture();

    await expect(service(await buyer(), capture).login({ ...login, password: 'wrong' })).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(service(await buyer({ blockedAt: new Date() }), capture).login(login)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_BLOCKED',
    });
    await expect(service(await buyer(), capture, { channelRefuses: true }).login(login)).rejects.toMatchObject({
      statusCode: 403,
      code: 'SALES_CHANNEL_NOT_PERMITTED',
    });

    expect(capture.captured).toEqual([]);
  });

  it('logs a failed capture and completes the sign-in', async () => {
    const failure = new Error('database blip');
    const capture = recordingCapture(failure);

    const outcome = await service(await buyer(), capture).login(login);

    expect(outcome.status).toBe('authenticated');
    expect(capture.failures).toEqual([failure]);
  });
});
