import { describe, expect, it } from 'vitest';
import type { SettingWriteValidationInput } from '@endora-commerce/contracts';
import { createRetentionDaysValidator } from './retention-days-validator.js';

function input(proposedValue: unknown): SettingWriteValidationInput {
  return {
    code: 'assets.soft_delete_retention_days',
    ownerModuleId: 'assets_library',
    proposedValue,
    projection: [],
    targetedChannelIds: [],
  };
}

async function refusal(promise: Promise<void>): Promise<{ code: string; statusCode: number }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; statusCode: number };
  }
  throw new Error('expected a refusal');
}

// Issue #332 — a retention far enough out makes the purge date an invalid
// `Date`, and every asset and recursive folder delete fails on it.
describe('assets.soft_delete_retention_days write validator (#332)', () => {
  const validator = createRetentionDaysValidator();

  it('answers for exactly the retention setting, as assets_library', () => {
    expect(validator.contributorModuleId).toBe('assets_library');
    expect([...validator.codes]).toEqual(['assets.soft_delete_retention_days']);
  });

  it.each([1, 30, 3650])('accepts %s days', async (days) => {
    await expect(validator.validate(input(days))).resolves.toBeUndefined();
  });

  it.each([0, -1, 3651, 1e15, 1.5, Number.NaN, Infinity, '30', null])(
    'refuses %j with a 422',
    async (value) => {
      const error = await refusal(validator.validate(input(value)));
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('VALIDATION_FAILED');
    },
  );
});
