import { describe, expect, it } from 'vitest';
import {
  REGISTRATION_OPTIONS_CACHE_TAG,
  registrationOptionsRevalidation,
} from './registration-options-revalidation.js';

/**
 * Feature 173 (T046; FR-025) — the storefront's cached registration options are
 * dropped the moment an operator changes a registration setting the answer
 * depends on, and never for anything else.
 */

function recorder() {
  const calls: string[][] = [];
  return { calls, revalidator: { revalidate: async (tags: string[]) => void calls.push(tags) } };
}

describe('registrationOptionsRevalidation', () => {
  it.each([
    'organizations.registration.registry_lookup_enabled',
    'organizations.registration.gus_credentials',
  ])('%s ⇒ one revalidation of the options tag', async (settingCode) => {
    const { calls, revalidator } = recorder();
    await registrationOptionsRevalidation(revalidator)({ settingCode });
    expect(calls).toEqual([[REGISTRATION_OPTIONS_CACHE_TAG]]);
    expect(REGISTRATION_OPTIONS_CACHE_TAG).toBe('organizations:registration-options');
  });

  it.each([
    // The options answer does not reflect the Polish-sources mode (research R-11).
    'organizations.registration.registry_lookup_pl_sources',
    'organizations.moderation.mode',
    'cms.page_builder.translation.enabled',
  ])('%s ⇒ none', async (settingCode) => {
    const { calls, revalidator } = recorder();
    await registrationOptionsRevalidation(revalidator)({ settingCode });
    expect(calls).toEqual([]);
  });

  it('ignores a payload with no code', async () => {
    const { calls, revalidator } = recorder();
    await registrationOptionsRevalidation(revalidator)({});
    await registrationOptionsRevalidation(revalidator)(null);
    expect(calls).toEqual([]);
  });
});
