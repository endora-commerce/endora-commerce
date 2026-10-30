import { describe, expect, it, vi } from 'vitest';
import type { ResolveResult } from '@endora-commerce/contracts';
import { capabilityOf, resolveTranslationConfig, type TranslationConfigDeps } from './capability.js';

/**
 * Feature 151, T029 — the state table of `data-model.md` §1, in its evaluation
 * order, plus the configurable limit (T074).
 */

const SETTINGS = {
  'cms.page_builder.translation.enabled': true,
  'cms.page_builder.translation.llm_credentials': 'translator',
  'cms.page_builder.translation.max_source_characters': 40000,
};

function deps(
  over: {
    settings?: Partial<Record<keyof typeof SETTINGS, unknown>>;
    credentialsPresent?: boolean;
    resolved?: Partial<ResolveResult> & { values?: Record<string, unknown> };
    resolveError?: Error;
  } = {},
): TranslationConfigDeps & { resolve: ReturnType<typeof vi.fn> } {
  const values = { ...SETTINGS, ...over.settings } as Record<string, unknown>;
  const resolve = vi.fn(async () => {
    if (over.resolveError) throw over.resolveError;
    return {
      status: 'ok',
      typeCode: 'llm',
      providerCode: 'anthropic',
      values: { apiKey: 'sk-secret', model: 'claude-test', baseUrl: '' },
      ...over.resolved,
    } as unknown as ResolveResult;
  });
  return {
    readSetting: async (code) => values[code],
    isCredentialsPresent: () => over.credentialsPresent ?? true,
    resolveCredential: resolve,
    resolve,
  };
}

describe('resolveTranslationConfig', () => {
  it('is disabled when the switch is off, without touching credentials', async () => {
    const d = deps({ settings: { 'cms.page_builder.translation.enabled': false }, credentialsPresent: false });
    expect(capabilityOf(await resolveTranslationConfig(d))).toEqual({ status: 'disabled', maxCharacters: 40000 });
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it('is unavailable when the credentials module is absent', async () => {
    const d = deps({ credentialsPresent: false });
    expect((await resolveTranslationConfig(d)).status).toBe('unavailable');
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ['no reference', { settings: { 'cms.page_builder.translation.llm_credentials': '' } }],
    ['a dangling reference', { resolveError: new Error('no such configuration') }],
    ['a non-ok resolution', { resolved: { status: 'not_configured' } as Partial<ResolveResult> }],
    ['an unknown provider', { resolved: { providerCode: 'mistral_native' } }],
    ['a blank model', { resolved: { values: { apiKey: 'k', model: '  ' } } }],
    ['a blank key', { resolved: { values: { apiKey: '', model: 'm' } } }],
    ['openai_compatible without a Base URL', { resolved: { providerCode: 'openai_compatible', values: { apiKey: 'k', model: 'm' } } }],
    ['an invalid Base URL', { resolved: { providerCode: 'deepseek', values: { apiKey: 'k', model: 'm', baseUrl: 'ftp://x' } } }],
  ])('is not configured with %s', async (_label, over) => {
    expect((await resolveTranslationConfig(deps(over as Parameters<typeof deps>[0]))).status).toBe('not_configured');
  });

  it.each([
    ['anthropic', {}],
    ['deepseek', {}],
    ['openai_compatible', { baseUrl: 'https://openrouter.ai/api/v1' }],
  ])('is ready for %s, naming provider and model but no secret', async (provider, extra) => {
    const config = await resolveTranslationConfig(
      deps({ resolved: { providerCode: provider, values: { apiKey: 'sk-secret', model: 'm-1', ...extra } } }),
    );
    const capability = capabilityOf(config);
    expect(capability).toEqual({ status: 'ready', provider, model: 'm-1', maxCharacters: 40000 });
    expect(JSON.stringify(capability)).not.toMatch(/sk-secret|translator|openrouter/);
  });
});

describe('the configurable size limit', () => {
  it('defaults to 40 000', async () => {
    const d = deps();
    d.readSetting = async (code) =>
      code === 'cms.page_builder.translation.max_source_characters' ? undefined : (SETTINGS as Record<string, unknown>)[code];
    expect((await resolveTranslationConfig(d)).maxCharacters).toBe(40000);
  });

  it('honours a changed value', async () => {
    expect(
      (await resolveTranslationConfig(deps({ settings: { 'cms.page_builder.translation.max_source_characters': 1500 } })))
        .maxCharacters,
    ).toBe(1500);
  });

  it.each([999, 200001, 1.5, '40000', null])('reads a stored %j outside the bounds as the default', async (value) => {
    expect(
      (await resolveTranslationConfig(deps({ settings: { 'cms.page_builder.translation.max_source_characters': value } })))
        .maxCharacters,
    ).toBe(40000);
  });
});
