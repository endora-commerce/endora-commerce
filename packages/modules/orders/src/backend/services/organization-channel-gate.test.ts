import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertChannelAllowedForOrganization } from './organization-channel-gate.js';

/**
 * Issue #515 — an order an operator creates for a customer is placed on a
 * channel that must be one of the customer's Organization's active assigned
 * channels: the same rule the on-behalf quote request has followed since
 * feature 163. A channel the Organization is not assigned to, an inactive one,
 * and an id naming no channel at all get one answer — `422
 * ORDER_SALES_CHANNEL_NOT_ALLOWED` — so the refusal says nothing about which
 * channels exist. An unwired membership port fails closed.
 */

const ORG = '00000000-0000-4000-8000-0000000000a1';
const ASSIGNED = '00000000-0000-4000-8000-0000000000c1';
const INACTIVE = '00000000-0000-4000-8000-0000000000c2';
const UNASSIGNED = '00000000-0000-4000-8000-0000000000c3';

function membership() {
  return {
    listChannelsForEntity: vi.fn(async () => [
      { id: ASSIGNED, active: true },
      { id: INACTIVE, active: false },
    ]),
  };
}

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('assertChannelAllowedForOrganization', () => {
  it('accepts an active channel the Organization is assigned to', async () => {
    const port = membership();
    await expect(assertChannelAllowedForOrganization(port, ORG, ASSIGNED)).resolves.toBeUndefined();
    expect(port.listChannelsForEntity).toHaveBeenCalledWith('organization', ORG);
  });

  it.each([
    ['an unassigned channel', UNASSIGNED],
    ['an inactive assigned channel', INACTIVE],
    ['an id naming no channel', '00000000-0000-4000-8000-00000000dead'],
  ])('refuses %s with 422 ORDER_SALES_CHANNEL_NOT_ALLOWED', async (_label, channelId) => {
    const err = await refusal(assertChannelAllowedForOrganization(membership(), ORG, channelId));
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED);
  });

  it('refuses every channel of an Organization assigned to none', async () => {
    const port = { listChannelsForEntity: vi.fn(async () => []) };
    const err = await refusal(assertChannelAllowedForOrganization(port, ORG, ASSIGNED));
    expect(err.code).toBe(ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED);
  });

  it('fails closed with 500 INTERNAL when the membership port is not wired', async () => {
    const err = await refusal(assertChannelAllowedForOrganization(undefined, ORG, ASSIGNED));
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe(ERROR_CODES.INTERNAL);
  });
});
